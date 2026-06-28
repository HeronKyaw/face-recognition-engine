from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


class EnrollRequest(BaseModel):
    user_id: str = Field(..., min_length=1, max_length=50, description="Unique user identifier")
    
    class Config:
        json_schema_extra = {
            "example": {
                "user_id": "user_12345"
            }
        }


class EnrollResponse(BaseModel):
    success: bool
    user_id: str
    message: str
    embedding_stored: bool = False
    
    class Config:
        json_schema_extra = {
            "example": {
                "success": True,
                "user_id": "user_12345",
                "message": "Face enrolled successfully",
                "embedding_stored": True
            }
        }


class VerifyRequest(BaseModel):
    pass  # Only file upload, no JSON body


class VerifyResponse(BaseModel):
    success: bool
    user_id: Optional[str] = None
    name: Optional[str] = None
    metadata: Optional[str] = None
    distance: Optional[float] = None
    message: str
    
    class Config:
        json_schema_extra = {
            "example": {
                "success": True,
                "user_id": "user_12345",
                "name": "John Doe",
                "metadata": "{\"department\": \"engineering\"}",
                "distance": 0.23,
                "message": "Identity verified successfully"
            }
        }


class EmbeddingResponse(BaseModel):
    user_id: str
    embedding: list[float]
    distance: float
    
    class Config:
        json_schema_extra = {
            "example": {
                "user_id": "user_12345",
                "embedding": [0.1, 0.2, ...],
                "distance": 0.23
            }
        }