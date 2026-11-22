"""Shared Redis connection (Valkey/Redis server, or in-memory fallback for tests) and pub/sub helpers."""
import asyncio
import json
import logging

import redis.asyncio as redis

from app.config import settings

logger = logging.getLogger("exampulse.redis")


def exam_channel(exam_id: str) -> str:
    return f"exam:{exam_id}:events"


def attempt_channel(attempt_id: str) -> str:
    return f"attempt:{attempt_id}:events"


class RedisStore:
    def __init__(self) -> None:
        self.client: redis.Redis | None = None
        self.is_fake = False
        self._background_tasks: set[asyncio.Task] = set()

    async def connect(self) -> None:
        if self.client is not None:
            return
        client = redis.from_url(settings.redis_url, decode_responses=True, socket_connect_timeout=2)
        try:
            await client.ping()
            self.client = client
            logger.info("Connected to Redis at %s", settings.redis_url)
        except (redis.ConnectionError, OSError) as error:
            await client.aclose()
            if not settings.allow_fake_redis:
                raise
            import fakeredis

            logger.warning("Redis unreachable (%s). Using in-memory fallback (single instance only).", error)
            self.client = fakeredis.FakeAsyncRedis(decode_responses=True)
            self.is_fake = True

    async def close(self) -> None:
        if self.client is not None:
            await self.client.aclose()
            self.client = None

    async def publish(self, channel: str, event_type: str, **payload) -> None:
        """Live events are best-effort: a Redis hiccup must never fail a candidate's request."""
        try:
            await self.client.publish(channel, json.dumps({"type": event_type, **payload}, default=str))
        except Exception:  # noqa: BLE001 - logged and intentionally swallowed
            logger.exception("Failed to publish %s on %s", event_type, channel)

    def publish_in_background(self, channel: str, event_type: str, **payload) -> None:
        task = asyncio.create_task(self.publish(channel, event_type, **payload))
        # Keep a strong reference until done; otherwise the task may be garbage-collected mid-flight.
        self._background_tasks.add(task)
        task.add_done_callback(self._background_tasks.discard)


redis_store = RedisStore()

