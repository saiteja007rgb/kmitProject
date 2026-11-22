"""Runtime configuration, read from environment variables or `backend/.env`."""
import logging
import secrets
from pathlib import Path

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
logger = logging.getLogger("exampulse.config")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", extra="ignore")

    environment: str = "development"  # "production" turns on strict checks
    instance_id: str = "backend-1"

    database_url: str = f"sqlite+aiosqlite:///{BACKEND_DIR / 'exampulse_v2.db'}"
    redis_url: str = "redis://localhost:6379/0"
    # In-memory Redis substitute. Only for tests / offline demos: it is per-process,
    # so live events and rate limits are not shared between backend instances.
    allow_fake_redis: bool = True

    jwt_secret: str = ""
    access_token_minutes: int = 15
    refresh_token_days: int = 7
    bcrypt_rounds: int = 12
    secure_cookies: bool = False  # enable when served over HTTPS
    cors_origins: list[str] = ["http://127.0.0.1:5173", "http://localhost:5173"]
    trust_proxy_headers: bool = False  # honour X-Forwarded-For only behind our own NGINX

    max_failed_logins: int = 5
    lockout_minutes: int = 15
    max_request_bytes: int = 3 * 1024 * 1024

    storage_dir: Path = BACKEND_DIR / "storage"
    seed_demo_data: bool = True
    initial_admin_password: str = "admin123"

    @model_validator(mode="after")
    def ensure_jwt_secret(self) -> "Settings":
        if self.jwt_secret:
            return self
        if self.environment == "production":
            raise ValueError("JWT_SECRET must be set in production.")
        # A per-process secret works for a single instance; run.sh writes a shared one to .env.
        logger.warning("JWT_SECRET not set; using a random per-process secret.")
        self.jwt_secret = secrets.token_urlsafe(48)
        return self

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")


settings = Settings()
