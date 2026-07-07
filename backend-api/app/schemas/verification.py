from pydantic import BaseModel, Field, ConfigDict
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


class LivenessResult(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    passed: bool
    passive_score: float = Field(ge=0.0, le=1.0)
    blur_score: float = Field(ge=0.0, le=1.0)
    color_score: float = Field(ge=0.0, le=1.0)
    blink_detected: bool
    frame_diversity_ok: bool
    message: str = ""


class EnrollResponse(BaseModel):
    success: bool
    user_id: str
    message: str
    embedding_stored: bool = False
    liveness: Optional[LivenessResult] = None
    
    class Config:
        json_schema_extra = {
            "example": {
                "success": True,
                "user_id": "user_12345",
                "message": "Face enrolled successfully",
                "embedding_stored": True,
                "liveness": {
                    "passed": True,
                    "passive_score": 0.75,
                    "blur_score": 0.82,
                    "color_score": 0.68,
                    "blink_detected": True,
                    "frame_diversity_ok": True,
                    "message": ""
                }
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
    liveness: Optional[LivenessResult] = None
    
    class Config:
        json_schema_extra = {
            "example": {
                "success": True,
                "user_id": "user_12345",
                "name": "John Doe",
                "metadata": "{\"department\": \"engineering\"}",
                "distance": 0.23,
                "message": "Identity verified successfully",
                "liveness": {
                    "passed": True,
                    "passive_score": 0.75,
                    "blur_score": 0.82,
                    "color_score": 0.68,
                    "blink_detected": True,
                    "frame_diversity_ok": True,
                    "message": ""
                }
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