"""Async SQLAlchemy engine and session factory (PostgreSQL in production, SQLite for tests)."""
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import settings


def _engine_options() -> dict:
    if settings.is_sqlite:
        return {"connect_args": {"timeout": 60}}
    # Two backend instances share PostgreSQL's default 100 connections: 2 x (20 + 20) = 80.
    return {"pool_size": 20, "max_overflow": 20, "pool_timeout": 30, "pool_recycle": 1800, "pool_pre_ping": True}


engine = create_async_engine(settings.database_url, **_engine_options())

if settings.is_sqlite:

    @event.listens_for(engine.sync_engine, "connect")
    def configure_sqlite(dbapi_connection, _record):
        cursor = dbapi_connection.cursor()
        # WAL lets readers proceed while a writer commits; busy_timeout queues writers instead of failing.
        for pragma in (
            "journal_mode=WAL",
            "synchronous=NORMAL",
            "busy_timeout=60000",
            "cache_size=-64000",
            "temp_store=MEMORY",
            "foreign_keys=ON",
        ):
            cursor.execute(f"PRAGMA {pragma}")
        cursor.close()


SessionFactory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False, autoflush=False)


class Base(DeclarativeBase):
    pass


async def get_db():
    async with SessionFactory() as session:
        yield session
