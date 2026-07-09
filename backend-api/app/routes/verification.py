import logging
from typing import Optional

import cv2
import numpy as np
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status

from app.config import get_settings
from app.dependencies import get_challenge_service, get_chroma_service, get_mysql_service, get_opencv_service
from app.schemas.verification import (
    ChallengeInitResponse,
    EnrollResponse,
    LivenessMethod,
    LivenessResult,
    StepVerifyResponse,
    VerifyResponse,
)
from app.services import ChallengeService, ChromaService, MySQLService, OpenCVService

logger = logging.getLogger(__name__)
settings = get_settings()

router = APIRouter(prefix="/api/v1", tags=["Face Verification"])


async def _perform_liveness_check(
    image_bytes: bytes,
    frames_bytes: list[bytes],
) -> LivenessResult:
    from app.services.liveness_service import LivenessService as LS

    nparr = np.frombuffer(image_bytes, np.uint8)
    image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if image is None:
        raise HTTPException(status_code=400, detail="Failed to decode primary image")

    if len(frames_bytes) < settings.liveness_min_frames:
        return LivenessResult(
            passed=False,
            passive_score=0.0,
            blur_score=0.0,
            color_score=0.0,
            blink_detected=False,
            frame_diversity_ok=False,
            method=LivenessMethod.frame_burst,
            message=f"Insufficient liveness frames: got {len(frames_bytes)}, need at least {settings.liveness_min_frames}",
        )

    frames = LS.decode_frames(frames_bytes)
    if len(frames) < 2:
        return LivenessResult(
            passed=False,
            passive_score=0.0,
            blur_score=0.0,
            color_score=0.0,
            blink_detected=False,
            frame_diversity_ok=False,
            method=LivenessMethod.frame_burst,
            message="Failed to decode liveness frames",
        )

    return LS.full_assessment(image, frames)


async def _perform_challenge_liveness_check(
    image_bytes: bytes,
    challenge_id: str,
    liveness_frames: list[UploadFile],
) -> LivenessResult:
    from app.services.liveness_service import LivenessService as LS

    nparr = np.frombuffer(image_bytes, np.uint8)
    image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if image is None:
        raise HTTPException(status_code=400, detail="Failed to decode primary image")

    passive = LS.assess_passive(image)

    if not ChallengeService.verify_full_challenge(challenge_id):
        return LivenessResult(
            passed=False,
            passive_score=passive["passive_score"],
            blur_score=passive["blur_score"],
            color_score=passive["color_score"],
            blink_detected=False,
            frame_diversity_ok=False,
            method=LivenessMethod.challenge,
            challenge_verified=False,
            message="Challenge-response not fully completed",
        )

    return LivenessResult(
        passed=passive["passed"],
        passive_score=passive["passive_score"],
        blur_score=passive["blur_score"],
        color_score=passive["color_score"],
        blink_detected=False,
        frame_diversity_ok=False,
        method=LivenessMethod.challenge,
        challenge_verified=True,
        message="" if passive["passed"] else "Passive liveness check failed",
    )


def _decode_image(image_bytes: bytes) -> np.ndarray:
    nparr = np.frombuffer(image_bytes, np.uint8)
    image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if image is None:
        raise HTTPException(status_code=400, detail="Failed to decode image")
    return image


@router.post(
    "/challenge/init",
    response_model=ChallengeInitResponse,
    status_code=status.HTTP_200_OK,
    summary="Initialize a challenge-response sequence",
    description="Returns a random sequence of actions for the user to perform (blink, head turn, smile, etc.)",
)
async def init_challenge(
    challenge: ChallengeService = Depends(get_challenge_service),
):
    return challenge.init_challenge()


@router.post(
    "/challenge/step",
    response_model=StepVerifyResponse,
    status_code=status.HTTP_200_OK,
    summary="Verify one step of the challenge sequence",
    description="Send frames for one challenge step; server detects if the user performed the requested action",
)
async def verify_challenge_step(
    challenge_id: str = Form(..., description="Challenge ID from /challenge/init"),
    step_index: int = Form(..., description="0-based step index"),
    liveness_frames: list[UploadFile] = File(..., description="Frames for this step"),
    challenge: ChallengeService = Depends(get_challenge_service),
):
    frames_bytes = []
    for f in liveness_frames:
        fb = await f.read()
        if fb:
            frames_bytes.append(fb)

    return challenge.verify_step(challenge_id, step_index, frames_bytes)


@router.post(
    "/enroll",
    response_model=EnrollResponse,
    status_code=status.HTTP_200_OK,
    summary="Enroll face for existing user",
    description="""
    Enroll a face image for an existing user.

    **Liveness Methods:**
    - `frame_burst` (default): Passive + blink detection + frame diversity
    - `challenge`: Sequential challenge-response (call /challenge/init + /challenge/step first)

    **Anti-Fraud Logic:**
    1. Verify user_id exists in MySQL
    2. Extract face embedding from image
    3. Search ChromaDB for similar face (1:N)
    4. If match found with distance < threshold: REJECT
    5. If unique: Store embedding in ChromaDB
    """,
)
async def enroll_face(
    user_id: str = Form(..., description="Existing user ID from MySQL"),
    face_image: UploadFile = File(..., description="Cropped face image (JPEG/PNG)"),
    liveness_frames: list[UploadFile] = File(default=[], description="Frames for liveness check"),
    method: LivenessMethod = Form(default=LivenessMethod.frame_burst, description="Liveness method"),
    challenge_id: Optional[str] = Form(None, description="Challenge ID (required if method=challenge)"),
    mysql: MySQLService = Depends(get_mysql_service),
    chroma: ChromaService = Depends(get_chroma_service),
    opencv: OpenCVService = Depends(get_opencv_service),
):
    if not mysql.user_exists(user_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"User '{user_id}' not found. Create user first via POST /api/v1/users",
        )

    try:
        image_bytes = await face_image.read()
        if not image_bytes:
            raise HTTPException(status_code=400, detail="Empty image file")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to read image: {e}")

    frames_bytes = []
    for f in liveness_frames:
        fb = await f.read()
        if fb:
            frames_bytes.append(fb)

    if method == LivenessMethod.challenge:
        if not challenge_id:
            raise HTTPException(status_code=400, detail="challenge_id is required when method=challenge")
        liveness_result = await _perform_challenge_liveness_check(image_bytes, challenge_id, liveness_frames)
    else:
        liveness_result = await _perform_liveness_check(image_bytes, frames_bytes)

    if not liveness_result.passed:
        logger.warning(f"Liveness check failed during enrollment for user '{user_id}': {liveness_result.message}")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=liveness_result.message,
        )

    try:
        embedding = opencv.extract_embedding_from_bytes(image_bytes)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        logger.error(f"Embedding extraction failed: {e}")
        raise HTTPException(status_code=500, detail="Face processing failed")

    try:
        search_result = chroma.search_embedding(embedding.tolist())
    except Exception as e:
        logger.error(f"ChromaDB search failed during enrollment: {e}")
        raise HTTPException(status_code=503, detail="Face search service unavailable")

    if search_result and search_result.distance < settings.verification_threshold:
        logger.warning(
            f"Anti-fraud: Face for user '{user_id}' matches existing user "
            f"'{search_result.user_id}' (distance={search_result.distance:.4f})"
        )
        return EnrollResponse(
            success=False,
            user_id=user_id,
            message=(
                f"Face already registered to another user (distance: {search_result.distance:.4f}). "
                f"Enrollment rejected for anti-fraud."
            ),
            embedding_stored=False,
            liveness=liveness_result,
        )

    try:
        chroma.add_embedding(user_id, embedding.tolist())
    except Exception as e:
        logger.error(f"Failed to store embedding: {e}")
        raise HTTPException(status_code=500, detail="Failed to store face embedding")

    mysql.set_face_enrolled(user_id, enrolled=True)

    logger.info(f"Face enrolled successfully for user: {user_id}")
    return EnrollResponse(
        success=True,
        user_id=user_id,
        message="Face enrolled successfully",
        embedding_stored=True,
        liveness=liveness_result,
    )


@router.post(
    "/verify",
    response_model=VerifyResponse,
    status_code=status.HTTP_200_OK,
    summary="Verify face against database",
    description="""
    Verify a face image against all enrolled faces (1:N identification).

    **Liveness Methods:**
    - `frame_burst` (default): Passive + blink detection + frame diversity
    - `challenge`: Sequential challenge-response (call /challenge/init + /challenge/step first)

    **Logic:**
    1. Extract face embedding from image
    2. Search ChromaDB for nearest neighbor
    3. If distance < threshold: Return matched user details
    4. If distance >= threshold or no match: Return 401 Unauthorized
    """,
)
async def verify_face(
    face_image: UploadFile = File(..., description="Face image to verify"),
    liveness_frames: list[UploadFile] = File(default=[], description="Frames for liveness check"),
    device_id: Optional[str] = Form(None, description="Identifier of the device performing verification"),
    method: LivenessMethod = Form(default=LivenessMethod.frame_burst, description="Liveness method"),
    challenge_id: Optional[str] = Form(None, description="Challenge ID (required if method=challenge)"),
    chroma: ChromaService = Depends(get_chroma_service),
    opencv: OpenCVService = Depends(get_opencv_service),
    mysql: MySQLService = Depends(get_mysql_service),
):
    try:
        image_bytes = await face_image.read()
        if not image_bytes:
            raise HTTPException(status_code=400, detail="Empty image file")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to read image: {e}")

    frames_bytes = []
    for f in liveness_frames:
        fb = await f.read()
        if fb:
            frames_bytes.append(fb)

    if method == LivenessMethod.challenge:
        if not challenge_id:
            raise HTTPException(status_code=400, detail="challenge_id is required when method=challenge")
        liveness_result = await _perform_challenge_liveness_check(image_bytes, challenge_id, liveness_frames)
    else:
        liveness_result = await _perform_liveness_check(image_bytes, frames_bytes)

    if not liveness_result.passed:
        logger.warning(f"Liveness check failed during verification: {liveness_result.message}")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=liveness_result.message,
        )

    try:
        embedding = opencv.extract_embedding_from_bytes(image_bytes)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        logger.error(f"Embedding extraction failed: {e}")
        raise HTTPException(status_code=500, detail="Face processing failed")

    try:
        search_result = chroma.search_embedding(embedding.tolist())
    except Exception as e:
        logger.error(f"ChromaDB search failed during verification: {e}")
        raise HTTPException(status_code=503, detail="Face search service unavailable")

    if not search_result:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No matching face found",
        )

    if search_result.distance >= settings.verification_threshold:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Face not recognized (distance: {search_result.distance:.4f})",
        )

    user = mysql.get_user(search_result.user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Identity data inconsistency",
        )

    mysql.log_verification(
        user_id=user.user_id,
        distance=search_result.distance,
        device_id=device_id,
    )

    logger.info(f"Identity verified: user={user.user_id}, distance={search_result.distance:.4f}")
    return VerifyResponse(
        success=True,
        user_id=user.user_id,
        name=user.name,
        metadata=user.metadata,
        distance=search_result.distance,
        message="Identity verified successfully",
        liveness=liveness_result,
    )
