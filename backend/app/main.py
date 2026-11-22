"""FastAPI application entry point, lifespan startup/shutdown, security middleware, and health endpoint."""
import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.exc import OperationalError, ProgrammingError

from app.config import settings
from app.core.middleware import SecurityMiddleware
from app.core.redis_store import redis_store
from app.database import Base, SessionFactory, engine
from app.routers.admin_exams import router as admin_exams_router
from app.routers.admin_monitor import router as admin_monitor_router
from app.routers.admin_people import router as admin_people_router
from app.routers.auth import router as auth_router
from app.routers.candidate import router as candidate_router
from app.routers.extras import router as extras_router
from app.routers.websockets import router as websockets_router
from app.seed import seed_database
from app.services.scoring import sweep_expired_attempts_once

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s [%(name)s] %(message)s")
logger = logging.getLogger("exampulse.main")


async def _expiry_sweeper_loop() -> None:
    while True:
        try:
            await asyncio.sleep(30)
            await sweep_expired_attempts_once()
        except asyncio.CancelledError:
            break
        except Exception:  # noqa: BLE001
            logger.exception("Error while sweeping expired attempts")


async def _ensure_incremental_columns() -> None:
    """Safely adds v2.1 columns onto existing local SQLite/PostgreSQL databases without dropping data."""
    column_specs = [
        ("users", "email_verified", "BOOLEAN NOT NULL DEFAULT TRUE"),
        ("users", "totp_secret", "VARCHAR(64)"),
        ("users", "totp_enabled", "BOOLEAN NOT NULL DEFAULT FALSE"),
        ("users", "backup_codes", "JSON"),
        ("exams", "access_code", "VARCHAR(32)"),
    ]
    for table_name, col_name, col_ddl in column_specs:
        try:
            async with engine.begin() as connection:
                await connection.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {col_name} {col_ddl}"))
        except (OperationalError, ProgrammingError):
            pass


@asynccontextmanager
async def lifespan(_app: FastAPI):
    logger.info("Starting ExamPulse v2 [%s]...", settings.instance_id)
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
    except (OperationalError, ProgrammingError) as exc:
        # Multi-instance race: another replica created the tables at the exact same moment.
        if "already exists" not in str(exc).lower():
            raise
    await _ensure_incremental_columns()
    await seed_database()
    await redis_store.connect()

    sweeper = asyncio.create_task(_expiry_sweeper_loop())
    logger.info("ExamPulse v2 [%s] ready (sqlite=%s, fake_redis=%s).", settings.instance_id, settings.is_sqlite, redis_store.is_fake)
    yield
    sweeper.cancel()
    try:
        await sweeper
    except asyncio.CancelledError:
        pass
    await redis_store.close()
    await engine.dispose()


app = FastAPI(
    title="ExamPulse API",
    version="2.0.0",
    lifespan=lifespan,
    docs_url=None if settings.environment == "production" else "/docs",
    redoc_url=None if settings.environment == "production" else "/redoc",
)

app.add_middleware(SecurityMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
    expose_headers=["X-Require-TOTP", "X-Require-Verification", "Retry-After"],
)

app.include_router(auth_router)
app.include_router(admin_people_router)
app.include_router(admin_exams_router)
app.include_router(admin_monitor_router)
app.include_router(candidate_router)
app.include_router(extras_router)
app.include_router(websockets_router)


@app.get("/health")
async def health_check():
    db_ok = True
    try:
        async with SessionFactory() as db:
            await db.execute(text("SELECT 1"))
    except Exception:  # noqa: BLE001
        db_ok = False

    return {
        "status": "healthy" if db_ok else "degraded",
        "version": "2.0.0",
        "instance_id": settings.instance_id,
        "database": "sqlite" if settings.is_sqlite else "postgresql",
        "redis": "in-memory-fallback" if redis_store.is_fake else "connected",
    }
