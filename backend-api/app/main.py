"""
FastAPI Application - Face Verification & Identity API

Architecture:
- Thin router: All business logic delegated to service classes
- Dependency injection: Services initialized at startup via lifespan events
- Async endpoints: Non-blocking I/O for high concurrency
- Structured logging: JSON format for production observability
"""
import logging
import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routes.health import router as health_router
from app.routes.users import router as users_router
from app.routes.verification import router as verification_router
from app.services import ChallengeService, ChromaService, MySQLService, OpenCVService, SessionService, ImageQualityService

settings = get_settings()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting Face Verification API...")

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

    try:
        ChallengeService.initialize()
        logger.info("Challenge service initialized")
    except Exception as e:
        logger.error(f"Challenge service initialization failed: {e}")
        raise

    try:
        SessionService.initialize()
        logger.info("Session service initialized")
    except Exception as e:
        logger.error(f"Session service initialization failed: {e}")
        raise

    try:
        ImageQualityService.initialize()
        logger.info("Image quality service initialized")
    except Exception as e:
        logger.error(f"Image quality service initialization failed: {e}")
        raise

    logger.info("All services initialized successfully")

    yield

    logger.info("Shutting down services...")
    SessionService.close()
    ChallengeService.close()
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

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(verification_router)
app.include_router(users_router)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=settings.api_host,
        port=settings.api_port,
        workers=settings.api_workers,
        reload=settings.debug,
    )
