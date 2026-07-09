from app.services import MySQLService, ChromaService, OpenCVService, ChallengeService


def get_mysql_service() -> MySQLService:
    return MySQLService


def get_chroma_service() -> ChromaService:
    return ChromaService


def get_opencv_service() -> OpenCVService:
    return OpenCVService


def get_challenge_service() -> ChallengeService:
    return ChallengeService
