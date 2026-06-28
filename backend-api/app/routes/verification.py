import logging
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status

from app.config import get_settings
from app.dependencies import get_chroma_service, get_mysql_service, get_opencv_service
from app.schemas.verification import EnrollResponse, VerifyResponse
from app.services import ChromaService, MySQLService, OpenCVService

logger = logging.getLogger(__name__)
settings = get_settings()

router = APIRouter(prefix="/api/v1", tags=["Face Verification"])


@router.post(
    "/enroll",
    response_model=EnrollResponse,
    status_code=status.HTTP_200_OK,
    summary="Enroll face for existing user",
    description="""
    Enroll a face image for an existing user.

    **Anti-Fraud Logic:**
    1. Verify user_id exists in MySQL (404 if not)
    2. Extract face embedding from image
    3. Search ChromaDB for similar face (1:N)
    4. If match found with distance < 0.4: REJECT (face already registered)
    5. If unique: Store embedding in ChromaDB mapped to user_id

    **Input:** multipart/form-data with user_id (string) and face image file
    **Output:** Enrollment result with success status
    """,
)
async def enroll_face(
    user_id: str = Form(..., description="Existing user ID from MySQL"),
    face_image: UploadFile = File(..., description="Cropped face image (JPEG/PNG)"),
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

    try:
        embedding = opencv.extract_embedding_from_bytes(image_bytes)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        logger.error(f"Embedding extraction failed: {e}")
        raise HTTPException(status_code=500, detail="Face processing failed")

    search_result = chroma.search_embedding(embedding.tolist())

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
    )


@router.post(
    "/verify",
    response_model=VerifyResponse,
    status_code=status.HTTP_200_OK,
    summary="Verify face against database",
    description="""
    Verify a face image against all enrolled faces (1:N identification).

    **Logic:**
    1. Extract face embedding from image
    2. Search ChromaDB for nearest neighbor
    3. If distance < 0.4: Return matched user details from MySQL
    4. If distance >= 0.4 or no match: Return 401 Unauthorized

    **Input:** multipart/form-data with face image file and optional device_id
    **Output:** Verification result with user details on success

    Successful verifications are logged with device_id for audit.
    """,
)
async def verify_face(
    face_image: UploadFile = File(..., description="Face image to verify"),
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

    try:
        embedding = opencv.extract_embedding_from_bytes(image_bytes)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        logger.error(f"Embedding extraction failed: {e}")
        raise HTTPException(status_code=500, detail="Face processing failed")

    search_result = chroma.search_embedding(embedding.tolist())

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
    )
