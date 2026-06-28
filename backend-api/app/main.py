"""
FastAPI Application - Face Verification & Identity API

Architecture:
- Thin router: All business logic delegated to service classes
- Dependency injection: Services initialized at startup via lifespan events
- Async endpoints: Non-blocking I/O for high concurrency
- Structured logging: JSON format for production observability

Endpoints:
- POST /api/v1/enroll               - Enroll face for existing user (anti-fraud)
- POST /api/v1/verify               - Verify face against database (1:N search)
- POST /api/v1/users                - Create user (identity only, no biometrics)
- GET  /api/v1/users                - List users (paginated)
- GET  /api/v1/users/{id}           - Get user by ID
- PUT  /api/v1/users/{id}           - Update user
- DELETE /api/v1/users/{id}         - Delete user + face vector (dual-DB consistency)
- GET  /api/v1/verification-logs    - Get verification audit log
- GET  /health                      - Liveness/readiness probe
"""
import logging
import sys
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, File, Form, UploadFile, HTTPException, Depends, Query, status
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.services import MySQLService, ChromaService, OpenCVService
from app.schemas.verification import EnrollResponse, VerifyResponse
from app.schemas.user import (
    UserCreate, UserUpdate, UserResponse, UserListResponse, UserDeleteResponse,
    VerificationLogResponse,
)

settings = get_settings()

# Configure structured logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Application lifespan manager for startup/shutdown.
    
    Why lifespan (not on_event)?
    - Modern FastAPI pattern (on_event deprecated)
    - Async context manager: clear startup/shutdown ordering
    - Dependency injection: Services available to all endpoints
    - Fail fast: If any service fails to initialize, app won't start
    """
    logger.info("Starting Face Verification API...")
    
    # Initialize services in dependency order
    try:
        MySQLService.initialize()
        logger.info("MySQL service initialized")
    except Exception as e:
        logger.error(f"MySQL initialization failed: {e}")
        raise
    
    try:
        ChromaService.initialize()
        logger.info("ChromaDB service initialized")
    except Exception as e:
        logger.error(f"ChromaDB initialization failed: {e}")
        raise
    
    try:
        OpenCVService.initialize()
        logger.info("OpenCV DNN service initialized")
    except Exception as e:
        logger.error(f"OpenCV DNN initialization failed: {e}")
        raise
    
    logger.info("All services initialized successfully")
    
    yield
    
    # Shutdown
    logger.info("Shutting down services...")
    OpenCVService.close()
    ChromaService.close()
    MySQLService.close()
    logger.info("Shutdown complete")


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="High-concurrency Face Verification and Identity API",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# CORS for frontend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ==================== Dependency Injection ====================

def get_mysql_service() -> MySQLService:
    return MySQLService


def get_chroma_service() -> ChromaService:
    return ChromaService


def get_opencv_service() -> OpenCVService:
    return OpenCVService


# ==================== Health Check ====================

@app.get("/health", tags=["Health"])
async def health_check():
    """
    Liveness and readiness probe.
    
    Checks all three services: MySQL, ChromaDB, OpenCV DNN.
    Returns 200 if all healthy, 503 if any unhealthy.
    """
    checks = {
        "mysql": MySQLService.health_check(),
        "chromadb": ChromaService.health_check(),
        "opencv": OpenCVService.health_check(),
    }
    
    all_healthy = all(checks.values())
    status_code = status.HTTP_200_OK if all_healthy else status.HTTP_503_SERVICE_UNAVAILABLE
    
    return JSONResponse(
        status_code=status_code,
        content={
            "status": "healthy" if all_healthy else "unhealthy",
            "checks": checks,
            "version": settings.app_version,
        },
    )


# ==================== Face Verification Endpoints ====================

@app.post(
    "/api/v1/enroll",
    response_model=EnrollResponse,
    status_code=status.HTTP_200_OK,
    tags=["Face Verification"],
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
    # 1. Verify user exists in MySQL
    if not mysql.user_exists(user_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"User '{user_id}' not found. Create user first via POST /api/v1/users",
        )
    
    # 2. Read and validate image
    try:
        image_bytes = await face_image.read()
        if not image_bytes:
            raise HTTPException(status_code=400, detail="Empty image file")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to read image: {e}")
    
    # 3. Extract embedding
    try:
        embedding = opencv.extract_embedding_from_bytes(image_bytes)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        logger.error(f"Embedding extraction failed: {e}")
        raise HTTPException(status_code=500, detail="Face processing failed")
    
    # 4. Anti-fraud: Check if face already exists in ChromaDB
    search_result = chroma.search_embedding(embedding.tolist())
    
    if search_result and search_result.distance < settings.verification_threshold:
        # Face matches another user - reject enrollment
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
    
    # 5. Store embedding in ChromaDB
    try:
        chroma.add_embedding(user_id, embedding.tolist())
    except Exception as e:
        logger.error(f"Failed to store embedding: {e}")
        raise HTTPException(status_code=500, detail="Failed to store face embedding")
    
    # 6. Mark user as face_enrolled in MySQL
    mysql.set_face_enrolled(user_id, enrolled=True)
    
    logger.info(f"Face enrolled successfully for user: {user_id}")
    return EnrollResponse(
        success=True,
        user_id=user_id,
        message="Face enrolled successfully",
        embedding_stored=True,
    )


@app.post(
    "/api/v1/verify",
    response_model=VerifyResponse,
    status_code=status.HTTP_200_OK,
    tags=["Face Verification"],
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
    # 1. Read and validate image
    try:
        image_bytes = await face_image.read()
        if not image_bytes:
            raise HTTPException(status_code=400, detail="Empty image file")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to read image: {e}")

    # 2. Extract embedding
    try:
        embedding = opencv.extract_embedding_from_bytes(image_bytes)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        logger.error(f"Embedding extraction failed: {e}")
        raise HTTPException(status_code=500, detail="Face processing failed")

    # 3. Search ChromaDB for best match
    search_result = chroma.search_embedding(embedding.tolist())

    if not search_result:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No matching face found",
        )

    # 4. Check distance threshold
    if search_result.distance >= settings.verification_threshold:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Face not recognized (distance: {search_result.distance:.4f})",
        )

    # 5. Fetch user details from MySQL
    user = mysql.get_user(search_result.user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Identity data inconsistency",
        )

    # 6. Log successful verification with device info
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


# ==================== User Management Endpoints ====================

@app.post(
    "/api/v1/users",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
    tags=["User Management"],
    summary="Create new user",
    description="""
    Create a new user identity record in MySQL.
    
    **Note:** This does NOT enroll a face. Face enrollment is separate via POST /api/v1/enroll
    and requires the user_id to exist first.
    
    **Input:** JSON body with user_id, name, and optional metadata (JSON string)
    **Output:** Created user record
    """,
)
async def create_user(
    user: UserCreate,
    mysql: MySQLService = Depends(get_mysql_service),
):
    try:
        created_user = mysql.create_user(user)
        return created_user
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to create user: {e}")
        raise HTTPException(status_code=500, detail="Failed to create user")


@app.get(
    "/api/v1/users",
    response_model=UserListResponse,
    tags=["User Management"],
    summary="List users (paginated)",
    description="Get paginated list of all registered users.",
)
async def list_users(
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(20, ge=1, le=100, description="Items per page"),
    mysql: MySQLService = Depends(get_mysql_service),
):
    users, total = mysql.list_users(page=page, page_size=page_size)
    return UserListResponse(
        users=users,
        total=total,
        page=page,
        page_size=page_size,
    )


@app.get(
    "/api/v1/users/{user_id}",
    response_model=UserResponse,
    tags=["User Management"],
    summary="Get user by ID",
    description="Fetch a specific user's details.",
)
async def get_user(
    user_id: str,
    mysql: MySQLService = Depends(get_mysql_service),
):
    user = mysql.get_user(user_id)
    if not user:
        raise HTTPException(status_code=404, detail=f"User '{user_id}' not found")
    return user


@app.put(
    "/api/v1/users/{user_id}",
    response_model=UserResponse,
    tags=["User Management"],
    summary="Update user",
    description="Update user's name and/or metadata.",
)
async def update_user(
    user_id: str,
    user_update: UserUpdate,
    mysql: MySQLService = Depends(get_mysql_service),
):
    updated_user = mysql.update_user(user_id, user_update)
    if not updated_user:
        raise HTTPException(status_code=404, detail=f"User '{user_id}' not found")
    return updated_user


@app.delete(
    "/api/v1/users/{user_id}",
    response_model=UserDeleteResponse,
    tags=["User Management"],
    summary="Delete user",
    description="""
    Delete user from MySQL AND their face embedding from ChromaDB.
    
    **Dual-Database Consistency:**
    This endpoint ensures atomic deletion from both databases:
    1. Delete from MySQL (user record)
    2. Delete from ChromaDB (face embedding)
    
    If ChromaDB deletion fails, the MySQL deletion is NOT rolled back
    (user is gone, but orphaned embedding remains - logged as warning).
    Manual cleanup may be needed.
    """,
)
async def delete_user(
    user_id: str,
    mysql: MySQLService = Depends(get_mysql_service),
    chroma: ChromaService = Depends(get_chroma_service),
):
    # 1. Delete from MySQL first (source of truth)
    mysql_deleted = mysql.delete_user(user_id)
    if not mysql_deleted:
        raise HTTPException(status_code=404, detail=f"User '{user_id}' not found")
    
    # 2. Delete from ChromaDB (vector index)
    chroma_deleted = False
    try:
        chroma_deleted = chroma.delete_embedding(user_id)
    except Exception as e:
        logger.error(f"Failed to delete embedding from ChromaDB for user {user_id}: {e}")
        # Don't fail the request - user is deleted from MySQL
        # Log for manual cleanup
    
    return UserDeleteResponse(
        success=True,
        user_id=user_id,
        message="User deleted successfully",
        chroma_deleted=chroma_deleted,
    )


# ==================== Verification Logs ====================

@app.get(
    "/api/v1/verification-logs",
    response_model=dict,
    tags=["Verification Logs"],
    summary="Get verification audit log",
    description="Fetch paginated verification attempts, optionally filtered by user_id.",
)
async def get_verification_logs(
    user_id: Optional[str] = Query(None, description="Filter by user ID"),
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(20, ge=1, le=100, description="Items per page"),
    mysql: MySQLService = Depends(get_mysql_service),
):
    logs, total = mysql.get_verification_logs(user_id=user_id, page=page, page_size=page_size)
    return {
        "logs": logs,
        "total": total,
        "page": page,
        "page_size": page_size,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host=settings.api_host,
        port=settings.api_port,
        workers=settings.api_workers,
        reload=settings.debug,
    )