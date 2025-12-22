"""
Call Recording Worker - Processes recording tasks from Redis queue.
Runs Puppeteer to join meetings and record audio.

Run with: python -m api.workers.call_worker
"""

import asyncio
import json
import logging
import os
import sys
from datetime import datetime

import redis.asyncio as redis

# Setup path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("call_worker")

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
RECORDINGS_DIR = os.getenv("UPLOAD_DIR", "/app/uploads/calls")
RECORDER_SCRIPT = os.path.join(os.path.dirname(__file__), "../../recorder/record.js")


class CallWorker:
    """Worker that processes call recording tasks from Redis queue."""

    def __init__(self):
        self.redis = None
        self.active_recordings = {}  # call_id -> process

    async def run(self):
        """Main worker loop."""
        self.redis = await redis.from_url(REDIS_URL, encoding="utf-8", decode_responses=True)
        logger.info("Call Worker started, waiting for tasks...")

        # Start control command listener
        asyncio.create_task(self._listen_control_commands())

        while True:
            try:
                # Wait for task from queue (blocking)
                result = await self.redis.brpop("call_recording_tasks", timeout=5)

                if result:
                    _, task_json = result
                    task = json.loads(task_json)

                    logger.info(f"Got recording task: {task}")

                    # Start recording in separate coroutine
                    asyncio.create_task(self._record_meeting(task))

            except asyncio.CancelledError:
                logger.info("Worker shutting down...")
                break
            except Exception as e:
                logger.error(f"Worker error: {e}")
                await asyncio.sleep(1)

    async def _listen_control_commands(self):
        """Listen for control commands (stop, etc.)."""
        pubsub = self.redis.pubsub()
        await pubsub.psubscribe("call_control:*")

        async for message in pubsub.listen():
            if message["type"] == "pmessage":
                try:
                    channel = message["channel"]
                    call_id = int(channel.split(":")[1])
                    command = message["data"]

                    if command == "stop" and call_id in self.active_recordings:
                        logger.info(f"Stopping recording {call_id}")
                        process = self.active_recordings[call_id]
                        process.terminate()
                except Exception as e:
                    logger.error(f"Error processing control command: {e}")

    async def _record_meeting(self, task: dict):
        """Start Puppeteer to record a meeting."""
        call_id = task["call_id"]
        meeting_url = task["meeting_url"]
        bot_name = task["bot_name"]

        output_file = os.path.join(RECORDINGS_DIR, f"{call_id}.webm")

        try:
            # Update status
            await self._update_status(call_id, "connecting")

            # Check if recorder script exists
            if not os.path.exists(RECORDER_SCRIPT):
                logger.error(f"Recorder script not found: {RECORDER_SCRIPT}")
                await self._update_status(call_id, "failed", error="Recorder script not found")
                await self._update_db_status(call_id, "failed", "Recorder script not found")
                return

            # Run Node.js Puppeteer script
            process = await asyncio.create_subprocess_exec(
                "node", RECORDER_SCRIPT,
                "--url", meeting_url,
                "--name", bot_name,
                "--output", output_file,
                "--call-id", str(call_id),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )

            self.active_recordings[call_id] = process

            # Update status to recording
            await self._update_status(call_id, "recording")
            await self._update_db_status(call_id, "recording")

            # Wait for completion
            stdout, stderr = await process.communicate()

            del self.active_recordings[call_id]

            if process.returncode == 0:
                # Successfully recorded
                logger.info(f"Recording completed for call {call_id}")
                await self._update_status(call_id, "processing")
                await self._update_db_audio_path(call_id, output_file)

                # Start processing
                from api.services.call_processor import call_processor
                await call_processor.process_call(call_id)
            else:
                error = stderr.decode() if stderr else "Unknown error"
                logger.error(f"Recording failed for call {call_id}: {error}")
                await self._update_status(call_id, "failed", error=error)
                await self._update_db_status(call_id, "failed", error)

        except Exception as e:
            logger.error(f"Recording error for call {call_id}: {e}")
            await self._update_status(call_id, "failed", error=str(e))
            await self._update_db_status(call_id, "failed", str(e))
            if call_id in self.active_recordings:
                del self.active_recordings[call_id]

    async def _update_status(self, call_id: int, status: str, **kwargs):
        """Update status in Redis for quick polling."""
        try:
            data = {
                "status": status,
                "updated_at": datetime.utcnow().isoformat()
            }
            data.update(kwargs)

            await self.redis.hset(f"call:{call_id}", mapping=data)
            await self.redis.expire(f"call:{call_id}", 3600)
        except Exception as e:
            logger.warning(f"Failed to update Redis status: {e}")

    async def _update_db_status(self, call_id: int, status: str, error: str = None):
        """Update status in database."""
        try:
            from api.database import AsyncSessionLocal
            from api.models.database import CallRecording, CallStatus
            from sqlalchemy import select

            async with AsyncSessionLocal() as db:
                result = await db.execute(
                    select(CallRecording).where(CallRecording.id == call_id)
                )
                call = result.scalar_one_or_none()

                if call:
                    call.status = CallStatus(status)
                    if error:
                        call.error_message = error
                    if status == "recording":
                        call.started_at = datetime.utcnow()
                    elif status in ("done", "failed"):
                        call.ended_at = datetime.utcnow()

                    await db.commit()
        except Exception as e:
            logger.error(f"Failed to update DB status: {e}")

    async def _update_db_audio_path(self, call_id: int, path: str):
        """Update audio file path in database."""
        try:
            from api.database import AsyncSessionLocal
            from api.models.database import CallRecording, CallStatus
            from sqlalchemy import select

            async with AsyncSessionLocal() as db:
                result = await db.execute(
                    select(CallRecording).where(CallRecording.id == call_id)
                )
                call = result.scalar_one_or_none()

                if call:
                    call.audio_file_path = path
                    call.status = CallStatus.processing
                    await db.commit()
        except Exception as e:
            logger.error(f"Failed to update audio path: {e}")


async def main():
    """Entry point."""
    worker = CallWorker()
    await worker.run()


if __name__ == "__main__":
    asyncio.run(main())
