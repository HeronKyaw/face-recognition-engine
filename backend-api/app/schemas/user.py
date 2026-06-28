from pydantic import BaseModel, Field, ConfigDict
from typing import Optional
from datetime import datetime


class UserCreate(BaseModel):
    user_id: str = Field(..., min_length=1, max_length=50, description="Unique user identifier")
    name: str = Field(..., min_length=1, max_length=150, description="User's full name")
    metadata: Optional[str] = Field(None, description="JSON string for additional metadata")
    
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "user_id": "user_12345",
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


class UserResponse(BaseModel):
    user_id: str
    name: str
    metadata: Optional[str] = None
    face_enrolled: bool = False
    created_at: datetime
    
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
    created_at: datetime
    
    model_config = ConfigDict(
        from_attributes=True,
        json_schema_extra={
            "example": {
                "id": 1,
                "user_id": "user_12345",
                "device_id": "camera-gate-a-01",
                "distance": 0.23,
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