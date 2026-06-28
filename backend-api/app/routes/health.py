import logging

from fastapi import APIRouter, status
from fastapi.responses import JSONResponse

from app.config import get_settings
from app.services import MySQLService, ChromaService, OpenCVService

logger = logging.getLogger(__name__)
settings = get_settings()

router = APIRouter(tags=["Health"])


@router.get("/health")
async def health_check():
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
