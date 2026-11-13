import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.redis_client import redis_manager

@pytest_asyncio.fixture(scope="session", autouse=True)
async def setup_test_environment():
    # Ensure redis fake connection is initialized
    await redis_manager.connect()
    yield
    await redis_manager.close()

@pytest_asyncio.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as ac:
        yield ac

