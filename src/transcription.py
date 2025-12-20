import os
import tempfile
import asyncio
import subprocess
from pathlib import Path
from openai import AsyncOpenAI


class TranscriptionService:
    def __init__(self, api_key: str):
        self.client = AsyncOpenAI(api_key=api_key)

    async def transcribe_audio(self, file_path: str) -> str:
        """Transcribe audio file using Whisper API."""
        with open(file_path, "rb") as audio_file:
            response = await self.client.audio.transcriptions.create(
                model="whisper-1",
                file=audio_file,
                language="ru",  # Can be made configurable
            )
        return response.text

    async def transcribe_voice(self, file_path: str) -> str:
        """Transcribe voice message (OGG format)."""
        return await self.transcribe_audio(file_path)

    async def transcribe_video_note(self, file_path: str) -> str:
        """
        Transcribe video note by extracting audio first.
        Requires ffmpeg to be installed.
        """
        audio_path = None
        try:
            # Create temporary audio file
            with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
                audio_path = tmp.name

            # Extract audio from video using ffmpeg
            process = await asyncio.create_subprocess_exec(
                "ffmpeg",
                "-i", file_path,
                "-vn",  # No video
                "-acodec", "libmp3lame",
                "-ar", "16000",  # Sample rate
                "-ac", "1",  # Mono
                "-y",  # Overwrite
                audio_path,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            await process.wait()

            if process.returncode != 0:
                raise RuntimeError("Failed to extract audio from video")

            # Transcribe the extracted audio
            return await self.transcribe_audio(audio_path)

        finally:
            # Clean up temporary audio file
            if audio_path and os.path.exists(audio_path):
                os.unlink(audio_path)

    async def download_and_transcribe(
        self,
        bot,
        file_id: str,
        is_video: bool = False,
    ) -> str:
        """Download file from Telegram and transcribe it."""
        file_path = None
        try:
            # Get file info from Telegram
            file = await bot.get_file(file_id)

            # Create temporary file
            suffix = ".mp4" if is_video else ".ogg"
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
                file_path = tmp.name

            # Download file
            await bot.download_file(file.file_path, destination=file_path)

            # Transcribe
            if is_video:
                return await self.transcribe_video_note(file_path)
            else:
                return await self.transcribe_voice(file_path)

        finally:
            # Clean up temporary file
            if file_path and os.path.exists(file_path):
                os.unlink(file_path)
