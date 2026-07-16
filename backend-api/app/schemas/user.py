from uuid import uuid4
from pydantic import BaseModel, Field, ConfigDict, model_validator
from typing import Optional
from datetime import datetime


class UserCreate(BaseModel):
    user_id: Optional[str] = Field(None, max_length=50, description="Unique user identifier (auto-generated if not provided)")
    name: str = Field(..., min_length=1, max_length=150, description="User's full name")
    metadata: Optional[str] = Field(None, description="JSON string for additional metadata")
    
    @model_validator(mode='after')
    def set_user_id(self):
        if self.user_id is None:
            self.user_id = uuid4().hex[:8]
        return self
    
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "name": "John Doe",
                "metadata": "{\"department\": \"engineering\", \"role\": \"engineer\"}"
            }
        }
    )


class UserUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=150)
    metadata: Optional[str] = None
    
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "name": "Jane Doe",
                "metadata": "{\"department\": \"engineering\", \"role\": \"senior_engineer\"}"
            }
        }
    )


class EmbeddingInfo(BaseModel):
    embedding_id: str
    glasses_detected: bool = False
    created_at: str = ""


class UserResponse(BaseModel):
    user_id: str
    name: str
    metadata: Optional[str] = None
    face_enrolled: bool = False
    created_at: datetime
    embeddings: list[EmbeddingInfo] = []
    
    model_config = ConfigDict(
        from_attributes=True,
        json_schema_extra={
            "example": {
                "user_id": "user_12345",
                "name": "John Doe",
                "metadata": "{\"department\": \"engineering\"}",
                "face_enrolled": True,
                "created_at": "2024-01-15T10:30:00Z"
            }
        }
    )


class VerificationLogResponse(BaseModel):
    id: int
    user_id: Optional[str] = None
    device_id: Optional[str] = None
    distance: Optional[float] = None
    success: bool = True
    reason: Optional[str] = None
    log_type: str = "verification"
    method: Optional[str] = None
    created_at: datetime
    
    model_config = ConfigDict(
        from_attributes=True,
        json_schema_extra={
            "example": {
                "id": 1,
                "user_id": "user_12345",
                "device_id": "camera-gate-a-01",
                "distance": 0.23,
                "success": True,
                "reason": None,
                "log_type": "verification",
                "method": "frame_burst",
                "created_at": "2024-01-15T10:30:00Z"
            }
        }
    )


class UserListResponse(BaseModel):
    users: list[UserResponse]
    total: int
    page: int
    page_size: int
    
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "users": [
                    {
                        "user_id": "user_12345",
                        "name": "John Doe",
                        "metadata": "{\"department\": \"engineering\"}",
                        "face_enrolled": True,
                        "created_at": "2024-01-15T10:30:00Z"
                    }
                ],
                "total": 1,
                "page": 1,
                "page_size": 20
            }
        }
    )


class UserDeleteResponse(BaseModel):
    success: bool
    user_id: str
    message: str
    chroma_deleted: bool = False
    
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "success": True,
                "user_id": "user_12345",
                "message": "User deleted successfully",
                "chroma_deleted": True
            }
        }
    )


class ResetEnrollmentsResponse(BaseModel):
    success: bool
    embeddings_removed: int
    users_reset: int
    message: str

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "success": True,
                "embeddings_removed": 15,
                "users_reset": 20,
                "message": "All face enrollments have been reset",
            }
        }
    )


class ResetFaceResponse(BaseModel):
    success: bool
    user_id: str
    message: str
    embedding_removed: bool = False

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "success": True,
                "user_id": "user_12345",
                "message": "Face enrollment reset for user user_12345",
                "embedding_removed": True,
            }
        }
    )


class DeleteEmbeddingResponse(BaseModel):
    success: bool
    user_id: str
    embedding_id: str
    message: str

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "success": True,
                "user_id": "user_12345",
                "embedding_id": "user_12345_abc123def456",
                "message": "Embedding deleted successfully",
            }
        }
    )