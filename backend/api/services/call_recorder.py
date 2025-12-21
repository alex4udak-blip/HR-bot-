"""
Call Recorder Service - Manages recording tasks via Redis queue.
Puppeteer worker reads from the queue and performs the actual recording.
"""

import logging
import json
from datetime import datetime
from typing import Optional

from ..config import settings

logger = logging.getLogger("hr-analyzer.call_recorder")


class CallRecorder:
    """Manages call recording tasks via Redis queue."""

    def __init__(self):
        self._redis = None

    async def get_redis(self):
        """Get or create Redis connection."""
        if self._redis is None:
            try:
                import redis.asyncio as redis
                self._redis = await redis.from_url(
                    settings.redis_url,
                    encoding="utf-8",
                    decode_responses=True
                )
                logger.info("Redis connection established")
            except Exception as e:
                logger.error(f"Failed to connect to Redis: {e}")
                raise
        return self._redis

    async def start_recording(self, call_id: int, meeting_url: str, bot_name: str):
        """Add a recording task to the queue."""
        try:
            r = await self.get_redis()

            task = {
                "call_id": call_id,
                "meeting_url": meeting_url,
                "bot_name": bot_name,
                "created_at": datetime.utcnow().isoformat()
            }

            await r.lpush("call_recording_tasks", json.dumps(task))
            logger.info(f"Recording task added for call {call_id}: {meeting_url}")

        except Exception as e:
            logger.error(f"Failed to add recording task: {e}")
            raise

    async def stop_recording(self, call_id: int):
        """Send a stop command for a recording."""
        try:
            r = await self.get_redis()
            await r.publish(f"call_control:{call_id}", "stop")
            logger.info(f"Stop command sent for call {call_id}")

        except Exception as e:
            logger.error(f"Failed to send stop command: {e}")
            raise

    async def get_status(self, call_id: int) -> Optional[dict]:
        """Get recording status from Redis (for quick status checks)."""
        try:
            r = await self.get_redis()
            status = await r.hgetall(f"call:{call_id}")
            return status if status else None

        except Exception as e:
            logger.warning(f"Failed to get status from Redis: {e}")
            return None

    async def update_status(self, call_id: int, status: str, **kwargs):
        """Update recording status in Redis (called by worker)."""
        try:
            r = await self.get_redis()

            data = {
                "status": status,
                "updated_at": datetime.utcnow().isoformat()
            }
            data.update(kwargs)

            await r.hset(f"call:{call_id}", mapping=data)
            await r.expire(f"call:{call_id}", 3600)  # TTL 1 hour

            logger.info(f"Status updated for call {call_id}: {status}")

        except Exception as e:
            logger.warning(f"Failed to update Redis status: {e}")

    async def cleanup(self):
        """Close Redis connection."""
        if self._redis:
            await self._redis.close()
            self._redis = None


# Global instance
call_recorder = CallRecorder()
