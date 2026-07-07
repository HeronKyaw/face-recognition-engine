import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.dependencies import get_chroma_service, get_mysql_service
from app.schemas.user import (
    ResetEnrollmentsResponse,
    ResetFaceResponse,
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


@router.delete(
    "/users/{user_id}/face",
    response_model=ResetFaceResponse,
    summary="Reset face enrollment for a user",
    description="""
    Remove the face embedding and reset enrollment status for a specific user.

    **Effects:**
    1. Deletes the user's face embedding from ChromaDB
    2. Sets `face_enrolled = FALSE` in MySQL

    The user record itself is NOT deleted.
    """,
)
async def reset_user_face(
    user_id: str,
    mysql: MySQLService = Depends(get_mysql_service),
    chroma: ChromaService = Depends(get_chroma_service),
):
    user = mysql.get_user(user_id)
    if not user:
        raise HTTPException(status_code=404, detail=f"User '{user_id}' not found")

    embedding_removed = False
    try:
        embedding_removed = chroma.delete_embedding(user_id)
    except Exception as e:
        logger.error(f"Failed to delete embedding for user {user_id}: {e}")

    mysql.set_face_enrolled(user_id, enrolled=False)

    if embedding_removed:
        message = f"Face enrollment reset for user {user_id}"
    else:
        message = f"No face embedding found for user {user_id}, enrollment status reset"

    logger.info(f"Face enrollment reset: user={user_id}, embedding_removed={embedding_removed}")
    return ResetFaceResponse(
        success=True,
        user_id=user_id,
        message=message,
        embedding_removed=embedding_removed,
    )


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


@router.post(
    "/reset-enrollments",
    response_model=ResetEnrollmentsResponse,
    status_code=status.HTTP_200_OK,
    summary="Reset all face enrollments",
    description="""
    Clear all face embeddings from ChromaDB and set face_enrolled = FALSE for all users.

    **Use case:** Re-enrollment campaign, system migration, or testing.

    **Effects:**
    1. Deletes all face embeddings from the vector index (ChromaDB collection recreated)
    2. Sets `face_enrolled = FALSE` for every user in MySQL

    User records themselves are NOT deleted.
    """,
)
async def reset_enrollments(
    mysql: MySQLService = Depends(get_mysql_service),
    chroma: ChromaService = Depends(get_chroma_service),
):
    embeddings_removed = chroma.reset_all_embeddings()
    users_reset = mysql.reset_all_face_enrolled()

    logger.warning(
        f"All enrollments reset: {embeddings_removed} embeddings removed, "
        f"{users_reset} users face_enrolled reset"
    )

    return ResetEnrollmentsResponse(
        success=True,
        embeddings_removed=embeddings_removed,
        users_reset=users_reset,
        message="All face enrollments have been reset",
    )
