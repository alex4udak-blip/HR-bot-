import os
import tempfile
import asyncio
import subprocess
from io import BytesIO
from openai import AsyncOpenAI
from ..config import get_settings

settings = get_settings()


class TranscriptionService:
    def __init__(self):
        self.client = AsyncOpenAI(api_key=settings.openai_api_key) if settings.openai_api_key else None

    async def transcribe_audio(self, audio_bytes: bytes) -> str:
        """Transcribe audio bytes using OpenAI Whisper."""
        if not self.client:
            return "[Транскрипция недоступна - OPENAI_API_KEY не настроен]"

        try:
            # Save bytes to temp file
            with tempfile.NamedTemporaryFile(suffix=".ogg", delete=False) as tmp:
                tmp.write(audio_bytes)
                tmp_path = tmp.name

            try:
                with open(tmp_path, "rb") as f:
                    response = await self.client.audio.transcriptions.create(
                        model="whisper-1", file=f, language="ru"
                    )
                return response.text
            finally:
                if os.path.exists(tmp_path):
                    os.unlink(tmp_path)
        except Exception as e:
            return f"[Ошибка транскрипции: {e}]"

    async def transcribe_video(self, video_bytes: bytes, filename: str = None) -> str:
        """Extract audio from video and transcribe."""
        if not self.client:
            return "[Транскрипция недоступна - OPENAI_API_KEY не настроен]"

        # Detect file extension from filename or use mp4 as default
        suffix = ".mp4"
        if filename:
            if filename.lower().endswith('.webm'):
                suffix = ".webm"
            elif filename.lower().endswith('.mov'):
                suffix = ".mov"
            elif filename.lower().endswith('.avi'):
                suffix = ".avi"

        video_path = None
        audio_path = None
        try:
            # Save video to temp file with correct extension
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
                tmp.write(video_bytes)
                video_path = tmp.name

            with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
                audio_path = tmp.name

            # Extract audio using ffmpeg
            process = await asyncio.create_subprocess_exec(
                "ffmpeg", "-i", video_path, "-vn", "-acodec", "libmp3lame",
                "-ar", "16000", "-ac", "1", "-y", audio_path,
                stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
            )
            _, stderr = await process.communicate()

            if process.returncode != 0:
                # Check if video has no audio stream
                stderr_text = stderr.decode() if stderr else ""
                if "does not contain any stream" in stderr_text or "Output file is empty" in stderr_text:
                    return "[Видео без звука]"
                return "[Не удалось извлечь аудио из видео]"

            # Check if audio file has content
            if os.path.getsize(audio_path) < 100:
                return "[Видео без звука]"

            # Read audio and transcribe
            with open(audio_path, "rb") as f:
                audio_bytes = f.read()
            return await self.transcribe_audio(audio_bytes)
        except Exception as e:
            return f"[Ошибка транскрипции видео: {e}]"
        finally:
            if video_path and os.path.exists(video_path):
                os.unlink(video_path)
            if audio_path and os.path.exists(audio_path):
                os.unlink(audio_path)


# Singleton instance
transcription_service = TranscriptionService()
