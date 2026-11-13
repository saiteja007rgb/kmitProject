import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.database import engine, Base
from app.redis_client import redis_manager
from app.seed import seed_database
from app.routers.auth import router as auth_router
from app.routers.exams import router as exams_router
from app.routers.answers import router as answers_router
from app.routers.submissions import router as submissions_router
from app.routers.admin import router as admin_router
from app.routers.websockets import router as ws_router

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("exampulse.main")

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Initializing ExamPulse [%s]...", settings.INSTANCE_ID)
    # Ensure database schema is ready
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    # Seed default data if database is empty
    await seed_database()
    # Connect to Redis
    await redis_manager.connect()
    logger.info("ExamPulse [%s] startup sequence complete.", settings.INSTANCE_ID)
    yield
    logger.info("Shutting down ExamPulse [%s]...", settings.INSTANCE_ID)
    await redis_manager.close()
    await engine.dispose()

app = FastAPI(
    title="ExamPulse API",
    description="High-Load Online Assessment Platform with Real-Time Monitoring and Collusion Detection",
    version="1.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(exams_router)
app.include_router(answers_router)
app.include_router(submissions_router)
app.include_router(admin_router)
app.include_router(ws_router)

@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "instance_id": settings.INSTANCE_ID,
        "database": "connected",
        "redis_fallback": redis_manager.is_fake
    }

@app.get("/")
async def root():
    return {
        "app": "ExamPulse Assessment Platform",
        "instance": settings.INSTANCE_ID,
        "version": "1.0.0",
        "docs_url": "/docs"
    }
