"""Shared pytest fixtures: isolated SQLite DB, in-memory Redis, fast test bcrypt, temp snapshot dir."""
import os
import shutil
import tempfile
from pathlib import Path

import pytest_asyncio
from httpx import ASGITransport, AsyncClient

TEST_DIR = Path(tempfile.mkdtemp(prefix="exampulse_test_"))
TEST_DB_PATH = TEST_DIR / "test.db"

os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{TEST_DB_PATH}"
os.environ["ALLOW_FAKE_REDIS"] = "true"
os.environ["REDIS_URL"] = "redis://127.0.0.1:6399/0"  # force fakeredis isolation in unit tests
os.environ["BCRYPT_ROUNDS"] = "4"  # fast in tests; production defaults to 12
os.environ["JWT_SECRET"] = "test-only-secret-key-not-for-production-use-123456"
os.environ["STORAGE_DIR"] = str(TEST_DIR / "storage")
os.environ["SEED_DEMO_DATA"] = "true"

from app.core.redis_store import redis_store  # noqa: E402
from app.database import engine  # noqa: E402
from app.main import app  # noqa: E402
from app.seed import seed_database  # noqa: E402


@pytest_asyncio.fixture(scope="session", autouse=True)
async def setup_test_environment():
    await redis_store.connect()
    await seed_database()
    yield
    await redis_store.close()
    await engine.dispose()
    shutil.rmtree(TEST_DIR, ignore_errors=True)


@pytest_asyncio.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as async_client:
        yield async_client


async def login_as(client: AsyncClient, username: str, password: str) -> tuple[str, dict]:
    resp = await client.post("/api/auth/login", json={"username": username, "password": password})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    return body["access_token"], body["user"]


def auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}
