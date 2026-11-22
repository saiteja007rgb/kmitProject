"""Redis-backed request throttling and login lockout. Fails open if Redis is down (availability first)."""
import logging
import time

from fastapi import HTTPException, status

from app.config import settings
from app.core.redis_store import redis_store

logger = logging.getLogger("exampulse.rate_limit")


async def enforce_rate_limit(key: str, limit: int, window_seconds: int) -> None:
    """Fixed-window counter: at most `limit` calls per `window_seconds` for `key`."""
    if redis_store.client is None:
        return
    window_index = int(time.time() // window_seconds)
    bucket = f"ratelimit:{key}:{window_index}"
    try:
        pipeline = redis_store.client.pipeline(transaction=False)
        pipeline.incr(bucket)
        pipeline.expire(bucket, window_seconds)
        call_count, _ = await pipeline.execute()
    except Exception:  # noqa: BLE001
        logger.exception("Rate limiter unavailable; allowing request")
        return
    if call_count > limit:
        retry_after = window_seconds - int(time.time()) % window_seconds
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Too many requests. Please slow down.",
            headers={"Retry-After": str(retry_after)},
        )


def _failed_login_key(username: str) -> str:
    return f"login_failures:{username.lower()}"


async def ensure_login_not_locked(username: str) -> None:
    if redis_store.client is None:
        return
    key = _failed_login_key(username)
    try:
        failures = await redis_store.client.get(key)
        if failures and int(failures) >= settings.max_failed_logins:
            retry_after = max(await redis_store.client.ttl(key), 1)
            raise HTTPException(
                status.HTTP_423_LOCKED,
                f"Too many failed attempts. Try again in {retry_after // 60 + 1} minute(s).",
                headers={"Retry-After": str(retry_after)},
            )
    except HTTPException:
        raise
    except Exception:  # noqa: BLE001
        logger.exception("Lockout check unavailable")


async def record_failed_login(username: str) -> None:
    if redis_store.client is None:
        return
    key = _failed_login_key(username)
    try:
        pipeline = redis_store.client.pipeline(transaction=False)
        pipeline.incr(key)
        pipeline.expire(key, settings.lockout_minutes * 60)
        await pipeline.execute()
    except Exception:  # noqa: BLE001
        logger.exception("Failed to record login failure")


async def clear_failed_logins(username: str) -> None:
    if redis_store.client is None:
        return
    try:
        await redis_store.client.delete(_failed_login_key(username))
    except Exception:  # noqa: BLE001
        logger.exception("Failed to clear login failures")
