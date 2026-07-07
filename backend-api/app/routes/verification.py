import logging
from typing import Optional

import cv2
import numpy as np
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status

from app.config import get_settings
from app.dependencies import get_chroma_service, get_mysql_service, get_opencv_service
from app.schemas.verification import EnrollResponse, LivenessResult, VerifyResponse
from app.services import ChromaService, MySQLService, OpenCVService

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
            message="Failed to decode liveness frames",
        )

    return LS.full_assessment(image, frames)


@router.post(
    "/enroll",
    response_model=EnrollResponse,
    status_code=status.HTTP_200_OK,
    summary="Enroll face for existing user",
    description="""
    Enroll a face image for an existing user.

    **Liveness Detection:**
    1. Passive liveness (blur/color analysis) on primary image
    2. Active liveness (blink detection) across liveness frames
    3. Frame diversity check (rejects static images)

    **Anti-Fraud Logic:**
    4. Verify user_id exists in MySQL (404 if not)
    5. Extract face embedding from image
    6. Search ChromaDB for similar face (1:N)
    7. If match found with distance < threshold: REJECT (face already registered)
    8. If unique: Store embedding in ChromaDB mapped to user_id

    **Input:** multipart/form-data with user_id (string), face image, and liveness frames
    **Output:** Enrollment result with success status
    """,
)
async def enroll_face(
    user_id: str = Form(..., description="Existing user ID from MySQL"),
    face_image: UploadFile = File(..., description="Cropped face image (JPEG/PNG)"),
    liveness_frames: list[UploadFile] = File(..., description="Burst frames for blink detection (JPEG)"),
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

    **Liveness Detection:**
    1. Passive liveness (blur/color analysis) on primary image
    2. Active liveness (blink detection) across liveness frames
    3. Frame diversity check (rejects static images)

    **Logic:**
    4. Extract face embedding from image
    5. Search ChromaDB for nearest neighbor
    6. If distance < threshold: Return matched user details from MySQL
    7. If distance >= threshold or no match: Return 401 Unauthorized

    **Input:** multipart/form-data with face image, liveness frames, and optional device_id
    **Output:** Verification result with user details and liveness assessment on success
    """,
)
async def verify_face(
    face_image: UploadFile = File(..., description="Face image to verify"),
    liveness_frames: list[UploadFile] = File(..., description="Burst frames for blink detection (JPEG)"),
    device_id: Optional[str] = Form(None, description="Identifier of the device performing verification"),
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
