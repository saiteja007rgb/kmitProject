"""Security & authentication tests: refresh rotation, theft detection, single device, lockout, RBAC, headers."""
import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from tests.conftest import auth_headers, login_as


@pytest.mark.asyncio
async def test_refresh_rotation_and_reuse_detection(client):
    resp = await client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
    assert resp.status_code == 200
    assert "x-content-type-options" in resp.headers
    assert resp.headers["x-frame-options"] == "DENY"
    assert resp.headers["cache-control"] == "no-store"

    first_cookie = resp.cookies.get("ep_refresh")
    assert first_cookie

    # First refresh rotates the cookie.
    client.cookies.set("ep_refresh", first_cookie)
    refresh_1 = await client.post("/api/auth/refresh")
    assert refresh_1.status_code == 200
    second_cookie = refresh_1.cookies.get("ep_refresh")
    assert second_cookie and second_cookie != first_cookie

    # Replaying the old (rotated) refresh cookie triggers theft detection and revokes the session.
    client.cookies.set("ep_refresh", first_cookie)
    replay = await client.post("/api/auth/refresh")
    assert replay.status_code == 401

    # Even the newly rotated cookie is now dead because the session was revoked.
    client.cookies.set("ep_refresh", second_cookie)
    after_revoke = await client.post("/api/auth/refresh")
    assert after_revoke.status_code == 401


@pytest.mark.asyncio
async def test_single_device_enforcement_for_candidate():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as device_a, AsyncClient(
        transport=transport, base_url="http://testserver"
    ) as device_b:
        token_a, _ = await login_as(device_a, "student1", "password123")
        ok_a = await device_a.get("/api/auth/me", headers=auth_headers(token_a))
        assert ok_a.status_code == 200

        token_b, _ = await login_as(device_b, "student1", "password123")
        ok_b = await device_b.get("/api/auth/me", headers=auth_headers(token_b))
        assert ok_b.status_code == 200

        revoked_a = await device_a.get("/api/auth/me", headers=auth_headers(token_a))
        assert revoked_a.status_code == 401
        assert "another device" in revoked_a.json()["detail"].lower()


@pytest.mark.asyncio
async def test_brute_force_lockout_and_rbac(client):
    # 5 bad attempts lock out that username (HTTP 423 + Retry-After).
    for _ in range(5):
        bad = await client.post("/api/auth/login", json={"username": "nonexistent_lock_target", "password": "wrong123"})
        assert bad.status_code == 401

    locked = await client.post("/api/auth/login", json={"username": "nonexistent_lock_target", "password": "wrong123"})
    assert locked.status_code == 423
    assert "retry-after" in locked.headers

    # Invigilator cannot access admin-only staff endpoint; candidate cannot access admin dashboard.
    invig_token, _ = await login_as(client, "invigilator", "invigilator123")
    assert (await client.get("/api/admin/staff", headers=auth_headers(invig_token))).status_code == 403
    assert (await client.get("/api/admin/dashboard", headers=auth_headers(invig_token))).status_code == 200

    cand_token, _ = await login_as(client, "student2", "password123")
    assert (await client.get("/api/admin/dashboard", headers=auth_headers(cand_token))).status_code == 403
    # Public self-registration does not exist.
    assert (await client.post("/api/auth/register", json={"username": "hacker"})).status_code == 404
