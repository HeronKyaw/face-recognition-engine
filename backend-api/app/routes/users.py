import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.dependencies import get_chroma_service, get_mysql_service
from app.schemas.user import (
    UserCreate,
    UserDeleteResponse,
    UserListResponse,
    UserResponse,
    UserUpdate,
    VerificationLogResponse,
)
from app.services import ChromaService, MySQLService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["User Management"])


@router.post(
    "/users",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
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


@router.get(
    "/users",
    response_model=UserListResponse,
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


@router.get(
    "/users/{user_id}",
    response_model=UserResponse,
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


@router.put(
    "/users/{user_id}",
    response_model=UserResponse,
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


@router.delete(
    "/users/{user_id}",
    response_model=UserDeleteResponse,
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
    mysql_deleted = mysql.delete_user(user_id)
    if not mysql_deleted:
        raise HTTPException(status_code=404, detail=f"User '{user_id}' not found")

    chroma_deleted = False
    try:
        chroma_deleted = chroma.delete_embedding(user_id)
    except Exception as e:
        logger.error(f"Failed to delete embedding from ChromaDB for user {user_id}: {e}")

    return UserDeleteResponse(
        success=True,
        user_id=user_id,
        message="User deleted successfully",
        chroma_deleted=chroma_deleted,
    )


# ==================== Enrollment Reset ====================

@router.post(
    "/users/{user_id}/reset-enrollment",
    summary="Reset face enrollment for a user",
    description="""
    Clear a user's face embedding from ChromaDB and reset face_enrolled flag.
    User can then re-enroll with a fresh image using POST /api/v1/enroll.
    Useful during OpenCV migration when old embeddings are incompatible.
    """,
)
async def reset_user_enrollment(
    user_id: str,
    mysql: MySQLService = Depends(get_mysql_service),
    chroma: ChromaService = Depends(get_chroma_service),
):
    if not mysql.user_exists(user_id):
        raise HTTPException(status_code=404, detail=f"User '{user_id}' not found")

    chroma.delete_embedding(user_id)
    mysql.set_face_enrolled(user_id, enrolled=False)

    return {
        "success": True,
        "user_id": user_id,
        "message": "Enrollment reset successfully",
    }


@router.post(
    "/reset-enrollments",
    summary="Reset all face enrollments",
    description="""
    Clear ALL face embeddings from ChromaDB and reset face_enrolled flag for ALL users.
    All users will need to re-enroll with POST /api/v1/enroll.
    Use carefully - this cannot be undone.
    """,
)
async def reset_all_enrollments(
    chroma: ChromaService = Depends(get_chroma_service),
    mysql: MySQLService = Depends(get_mysql_service),
):
    embeddings_cleared = chroma.reset_collection()
    users_reset = mysql.reset_all_face_enrolled()

    return {
        "success": True,
        "embeddings_cleared": embeddings_cleared,
        "users_reset": users_reset,
        "message": f"Cleared {embeddings_cleared} embeddings and reset {users_reset} users",
    }


# ==================== Verification Logs ====================

@router.get(
    "/verification-logs",
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

