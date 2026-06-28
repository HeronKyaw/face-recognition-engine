from app.services import MySQLService, ChromaService, OpenCVService


def get_mysql_service() -> MySQLService:
    return MySQLService


def get_chroma_service() -> ChromaService:
    return ChromaService


def get_opencv_service() -> OpenCVService:
    return OpenCVService
