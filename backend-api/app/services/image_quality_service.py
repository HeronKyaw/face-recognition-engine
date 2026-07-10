import logging
from typing import Optional

import cv2
import numpy as np

from app.config import get_settings
from app.services.liveness_service import LivenessService
from app.services.opencv_service import OpenCVService

logger = logging.getLogger(__name__)
settings = get_settings()


class ImageQualityService:

    @classmethod
    def initialize(cls) -> None:
        logger.info("ImageQualityService initialized")

    @classmethod
    def check_blur(cls, image: np.ndarray) -> dict:
        score = LivenessService.assess_blur(image)
        threshold = settings.quality_blur_threshold
        return {
            "score": round(score, 4),
            "threshold": threshold,
            "passed": score >= threshold,
        }

    @classmethod
    def check_brightness(cls, image: np.ndarray) -> dict:
        lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
        l_mean = float(np.mean(lab[:, :, 0]))
        min_val = settings.quality_brightness_min
        max_val = settings.quality_brightness_max
        return {
            "mean_luminance": round(l_mean, 2),
            "range": [min_val, max_val],
            "passed": min_val <= l_mean <= max_val,
        }

    @classmethod
    def check_face_size(cls, bbox: tuple) -> dict:
        x, y, w, h = bbox
        min_dim = min(w, h)
        threshold = settings.quality_min_face_size
        return {
            "width": w,
            "height": h,
            "min_dimension": min_dim,
            "threshold": threshold,
            "passed": min_dim >= threshold,
        }

    @classmethod
    def check_face_pose(cls, image: np.ndarray, landmarks) -> dict:
        pose = OpenCVService.estimate_head_pose(image, landmarks)
        if pose is None:
            return {"yaw": None, "pitch": None, "roll": None, "passed": False}
        max_yaw = settings.quality_max_yaw
        return {
            "yaw": round(pose["yaw"], 2),
            "pitch": round(pose["pitch"], 2),
            "roll": round(pose["roll"], 2),
            "max_yaw": max_yaw,
            "passed": abs(pose["yaw"]) <= max_yaw,
        }

    @classmethod
    def assess(cls, image: np.ndarray) -> dict:
        blur = cls.check_blur(image)
        brightness = cls.check_brightness(image)

        face_data = OpenCVService._detect_face(image)
        if face_data is None:
            return {
                "passed": False,
                "blur": blur,
                "brightness": brightness,
                "face_size": {"passed": False, "reason": "No face detected"},
                "face_pose": {"passed": False, "reason": "No face detected"},
            }

        bbox, landmarks = face_data
        face_size = cls.check_face_size(bbox)
        face_pose = cls.check_face_pose(image, landmarks)

        passed = blur["passed"] and brightness["passed"] and face_size["passed"] and face_pose["passed"]

        return {
            "passed": passed,
            "blur": blur,
            "brightness": brightness,
            "face_size": face_size,
            "face_pose": face_pose,
        }
