import os
import tempfile
import asyncio
import subprocess
from openai import AsyncOpenAI
from ..config import get_settings

settings = get_settings()
client = AsyncOpenAI(api_key=settings.openai_api_key) if settings.openai_api_key else None


async def transcribe_audio(file_path: str) -> str:
    if not client:
        return "[Транскрипция недоступна]"

    with open(file_path, "rb") as f:
        response = await client.audio.transcriptions.create(
            model="whisper-1", file=f, language="ru"
        )
    return response.text


async def transcribe_video(file_path: str) -> str:
    audio_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
            audio_path = tmp.name

        process = await asyncio.create_subprocess_exec(
            "ffmpeg", "-i", file_path, "-vn", "-acodec", "libmp3lame",
            "-ar", "16000", "-ac", "1", "-y", audio_path,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        await process.wait()

        if process.returncode != 0:
            return "[Не удалось извлечь аудио]"

        return await transcribe_audio(audio_path)
    finally:
        if audio_path and os.path.exists(audio_path):
            os.unlink(audio_path)
