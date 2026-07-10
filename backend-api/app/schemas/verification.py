from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, Any
from datetime import datetime
from enum import Enum


class LivenessMethod(str, Enum):
    frame_burst = "frame_burst"
    challenge = "challenge"


class EnrollRequest(BaseModel):
    user_id: str = Field(..., min_length=1, max_length=50, description="Unique user identifier")
    
    class Config:
        json_schema_extra = {
            "example": {
                "user_id": "user_12345"
            }
        }


class ChallengeInitResponse(BaseModel):
    challenge_id: str
    steps: list[dict[str, Any]]
    total_steps: int
    expires_at: str


class StepVerifyRequest(BaseModel):
    challenge_id: str
    step_index: int
    frames: list[str]


class StepVerifyResponse(BaseModel):
    passed: bool
    step_index: int
    next_step_index: Optional[int] = None
    completed: bool = False
    message: str = ""


class LivenessResult(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    passed: bool
    passive_score: float = Field(ge=0.0, le=1.0)
    blur_score: float = Field(ge=0.0, le=1.0)
    color_score: float = Field(ge=0.0, le=1.0)
    blink_detected: bool
    frame_diversity_ok: bool
    method: LivenessMethod = LivenessMethod.frame_burst
    challenge_verified: Optional[bool] = None
    challenge_expected_count: Optional[int] = None
    challenge_actual_count: Optional[int] = None
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


class BlurCheck(BaseModel):
    score: float
    threshold: float
    passed: bool


class BrightnessCheck(BaseModel):
    mean_luminance: float
    range: list[float]
    passed: bool


class FaceSizeCheck(BaseModel):
    width: int
    height: int
    min_dimension: int
    threshold: int
    passed: bool


class FacePoseCheck(BaseModel):
    yaw: Optional[float] = None
    pitch: Optional[float] = None
    roll: Optional[float] = None
    max_yaw: Optional[float] = None
    passed: bool


class QualityCheckResult(BaseModel):
    passed: bool
    blur: BlurCheck
    brightness: BrightnessCheck
    face_size: FaceSizeCheck | dict = None
    face_pose: FacePoseCheck | dict = None


class EnrollInitResponse(BaseModel):
    success: bool
    session_token: Optional[str] = None
    quality: Optional[QualityCheckResult] = None
    passive_liveness: Optional[LivenessResult] = None
    message: str


class EnrollCompleteResponse(BaseModel):
    success: bool
    user_id: str
    message: str
    embedding_stored: bool = False
    liveness: Optional[LivenessResult] = None


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