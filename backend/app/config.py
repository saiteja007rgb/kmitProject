import os
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_DB = f"sqlite+aiosqlite:///{os.path.join(BASE_DIR, 'exampulse.db')}"

class Settings(BaseSettings):
    INSTANCE_ID: str = os.getenv("INSTANCE_ID", "backend-1")
    DATABASE_URL: str = os.getenv("DATABASE_URL", DEFAULT_DB)
    REDIS_URL: str = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    USE_FAKE_REDIS_FALLBACK: bool = True
    JWT_SECRET: str = os.getenv("JWT_SECRET", "exampulse_secret_key_hackathon_2026")
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 60 * 24  # 24 hours
    CORS_ORIGINS: List[str] = [
        "http://localhost:3000",
        "http://localhost:5173",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5173",
        "*"
    ]

    model_config = SettingsConfigDict(env_file=".env", extra="allow")

settings = Settings()
