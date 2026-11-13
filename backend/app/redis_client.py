import json
import logging
from typing import Optional, Dict, Any, List
import redis.asyncio as aioredis
from app.config import settings

logger = logging.getLogger("exampulse.redis")

class RedisManager:
    def __init__(self):
        self.client: Optional[aioredis.Redis] = None
        self.pubsub_client: Optional[aioredis.Redis] = None
        self.is_fake: bool = False

    async def connect(self):
        try:
            client = aioredis.from_url(
                settings.REDIS_URL,
                decode_responses=True,
                socket_connect_timeout=2.0
            )
            await client.ping()
            self.client = client
            self.is_fake = False
            logger.info("Connected to live Redis instance at %s", settings.REDIS_URL)
        except Exception as e:
            if settings.USE_FAKE_REDIS_FALLBACK:
                logger.warning("Live Redis unreachable (%s). Using in-memory FakeRedis fallback.", str(e))
                import fakeredis.aioredis
                self.client = fakeredis.aioredis.FakeRedis(decode_responses=True)
                self.is_fake = True
            else:
                raise e

    async def close(self):
        if self.client:
            if hasattr(self.client, "aclose"):
                await self.client.aclose()
            else:
                await self.client.close()

    async def get_json(self, key: str) -> Optional[Any]:
        if not self.client:
            return None
        try:
            val = await self.client.get(key)
            return json.loads(val) if val else None
        except Exception as e:
            logger.error("Redis get_json error for %s: %s", key, str(e))
            return None

    async def set_json(self, key: str, value: Any, ttl: int = 3600):
        if not self.client:
            return
        try:
            await self.client.set(key, json.dumps(value), ex=ttl)
        except Exception as e:
            logger.error("Redis set_json error for %s: %s", key, str(e))

    async def publish_event(self, channel: str, message: Dict[str, Any]):
        if not self.client:
            return
        try:
            payload = json.dumps(message)
            await self.client.publish(channel, payload)
        except Exception as e:
            logger.error("Redis publish error on %s: %s", channel, str(e))

    # Leaderboard Operations using Redis Sorted Sets (ZSET)
    async def update_leaderboard(self, exam_id: str, candidate_code: str, score: float):
        if not self.client:
            return
        try:
            key = f"exam:{exam_id}:leaderboard"
            await self.client.zadd(key, {candidate_code: score})
        except Exception as e:
            logger.error("Redis leaderboard update error: %s", str(e))

    async def get_top_leaderboard(self, exam_id: str, limit: int = 50) -> List[tuple]:
        if not self.client:
            return []
        try:
            key = f"exam:{exam_id}:leaderboard"
            # returns list of (member, score)
            return await self.client.zrevrange(key, 0, limit - 1, withscores=True)
        except Exception as e:
            logger.error("Redis leaderboard fetch error: %s", str(e))
            return []

redis_manager = RedisManager()
