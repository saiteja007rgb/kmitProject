import os
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.ext.asyncio import AsyncSession

# Use a dedicated, fresh test database
TEST_DB_PATH = os.path.join(os.path.dirname(__file__), "test_exampulse.db")
TEST_DB_URL = f"sqlite+aiosqlite:///{TEST_DB_PATH}"

# Override DATABASE_URL before any app imports take effect
os.environ["DATABASE_URL"] = TEST_DB_URL

from app.main import app
from app.redis_client import redis_manager
from app.seed import seed_database


@pytest_asyncio.fixture(scope="session", autouse=True)
async def setup_test_environment():
    # Remove stale test DB
    if os.path.exists(TEST_DB_PATH):
        os.remove(TEST_DB_PATH)

    # Initialize Redis fake connection
    await redis_manager.connect()

    # Seed the test database (creates tables + inserts seed data)
    await seed_database()

    yield

    await redis_manager.close()
    # Clean up test DB after session
    if os.path.exists(TEST_DB_PATH):
        os.remove(TEST_DB_PATH)


@pytest_asyncio.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as ac:
        yield ac
