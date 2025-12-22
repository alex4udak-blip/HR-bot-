"""
Call Processor Service - Transcribes audio and analyzes content.
Uses OpenAI Whisper for transcription and Claude for analysis.
"""

import asyncio
import logging
import os
import json
from datetime import datetime
from typing import Optional

from openai import AsyncOpenAI
from anthropic import AsyncAnthropic

from ..config import settings

logger = logging.getLogger("hr-analyzer.call_processor")


class CallProcessor:
    """Processes call recordings: transcription + AI analysis."""

    def __init__(self):
        self.openai = None
        self.anthropic = None

    def _init_clients(self):
        """Initialize API clients lazily."""
        if self.openai is None and settings.openai_api_key:
            self.openai = AsyncOpenAI(api_key=settings.openai_api_key)
        if self.anthropic is None and settings.anthropic_api_key:
            self.anthropic = AsyncAnthropic(api_key=settings.anthropic_api_key)

    async def process_call(self, call_id: int):
        """Full processing pipeline for a call recording."""
        from ..database import AsyncSessionLocal
        from ..models.database import CallRecording, CallStatus
        from sqlalchemy import select

        self._init_clients()

        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(CallRecording).where(CallRecording.id == call_id)
            )
            call = result.scalar_one_or_none()

            if not call:
                logger.error(f"Call {call_id} not found")
                return

            if not call.audio_file_path:
                logger.error(f"Call {call_id} has no audio file")
                call.status = CallStatus.failed
                call.error_message = "No audio file"
                await db.commit()
                return

            try:
                # 1. Convert to WAV if needed
                audio_path = await self._convert_to_wav(call.audio_file_path)

                # 2. Transcribe via Whisper
                call.status = CallStatus.transcribing
                await db.commit()

                transcript = await self._transcribe(audio_path)
                call.transcript = transcript

                # 3. Get audio duration
                duration = await self._get_duration(call.audio_file_path)
                call.duration_seconds = duration

                # 4. AI analysis
                call.status = CallStatus.analyzing
                await db.commit()

                analysis = await self._analyze(transcript)
                call.summary = analysis.get("summary")
                call.action_items = analysis.get("action_items")
                call.key_points = analysis.get("key_points")

                # Done!
                call.status = CallStatus.done
                call.processed_at = datetime.utcnow()
                await db.commit()

                logger.info(f"Call {call_id} processed successfully")

                # Cleanup converted file if different from original
                if audio_path != call.audio_file_path and os.path.exists(audio_path):
                    os.remove(audio_path)

            except Exception as e:
                logger.error(f"Error processing call {call_id}: {e}")
                call.status = CallStatus.failed
                call.error_message = str(e)
                await db.commit()

    async def _convert_to_wav(self, input_path: str) -> str:
        """Convert audio to WAV 16kHz mono for Whisper."""
        if input_path.endswith('.wav'):
            return input_path

        output_path = input_path.rsplit('.', 1)[0] + '_converted.wav'

        cmd = [
            'ffmpeg', '-i', input_path,
            '-ar', '16000',  # 16kHz sample rate
            '-ac', '1',       # mono
            '-y',             # overwrite
            output_path
        ]

        try:
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            stdout, stderr = await process.communicate()

            if process.returncode != 0:
                logger.warning(f"ffmpeg conversion warning: {stderr.decode()}")
                # Return original if conversion fails
                return input_path

            return output_path

        except Exception as e:
            logger.warning(f"Conversion failed, using original: {e}")
            return input_path

    async def _transcribe(self, audio_path: str) -> str:
        """Transcribe audio using OpenAI Whisper API."""
        if not self.openai:
            raise ValueError("OpenAI API key not configured")

        with open(audio_path, 'rb') as f:
            response = await self.openai.audio.transcriptions.create(
                model="whisper-1",
                file=f,
                language="ru"  # Default to Russian, can be made configurable
            )

        return response.text

    async def _get_duration(self, audio_path: str) -> int:
        """Get audio duration in seconds using ffprobe."""
        cmd = [
            'ffprobe', '-i', audio_path,
            '-show_entries', 'format=duration',
            '-v', 'quiet', '-of', 'csv=p=0'
        ]

        try:
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            stdout, _ = await process.communicate()

            return int(float(stdout.decode().strip()))
        except Exception:
            return 0

    async def analyze_transcript(
        self,
        call_id: int,
        transcript: str,
        speakers: list,
        fireflies_summary: Optional[dict] = None
    ):
        """
        Analyze a transcript from Fireflies (already transcribed with speaker diarization).

        Args:
            call_id: Internal call ID
            transcript: Formatted transcript text
            speakers: List of speaker segments with timestamps
            fireflies_summary: Optional summary from Fireflies
        """
        from ..database import AsyncSessionLocal
        from ..models.database import CallRecording, CallStatus
        from sqlalchemy import select

        self._init_clients()

        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(CallRecording).where(CallRecording.id == call_id)
            )
            call = result.scalar_one_or_none()

            if not call:
                logger.error(f"Call {call_id} not found for transcript analysis")
                return

            try:
                call.status = CallStatus.analyzing
                call.transcript = transcript
                call.speakers = speakers
                await db.commit()

                # Use Fireflies summary if available, otherwise use Claude
                if fireflies_summary and fireflies_summary.get("overview"):
                    analysis = {
                        "summary": fireflies_summary.get("overview", ""),
                        "key_points": fireflies_summary.get("keywords", []),
                        "action_items": fireflies_summary.get("action_items", [])
                    }
                    logger.info(f"Using Fireflies summary for call {call_id}")
                else:
                    # Fallback to Claude analysis
                    analysis = await self._analyze(transcript)
                    logger.info(f"Used Claude analysis for call {call_id}")

                call.summary = analysis.get("summary")
                call.action_items = analysis.get("action_items")
                call.key_points = analysis.get("key_points")
                call.status = CallStatus.done
                call.processed_at = datetime.utcnow()
                await db.commit()

                logger.info(f"Call {call_id} transcript analyzed successfully")

            except Exception as e:
                logger.error(f"Error analyzing transcript for call {call_id}: {e}")
                call.status = CallStatus.failed
                call.error_message = str(e)
                await db.commit()

    async def _analyze(self, transcript: str) -> dict:
        """Analyze transcript using Claude."""
        if not self.anthropic:
            logger.warning("Anthropic API key not configured, skipping analysis")
            return {
                "summary": "Analysis not available (API key not configured)",
                "key_points": [],
                "action_items": []
            }

        prompt = f"""Проанализируй транскрипт созвона и выдели:

1. SUMMARY - краткое резюме разговора (2-3 абзаца)
2. KEY_POINTS - ключевые моменты и обсуждённые темы (список из 3-7 пунктов)
3. ACTION_ITEMS - задачи и договорённости, которые нужно выполнить (список)

Транскрипт:
---
{transcript[:15000]}
---

Ответь ТОЛЬКО валидным JSON без дополнительного текста:
{{
  "summary": "краткое резюме...",
  "key_points": ["пункт 1", "пункт 2", ...],
  "action_items": ["задача 1", "задача 2", ...]
}}"""

        try:
            response = await self.anthropic.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=2048,
                messages=[{"role": "user", "content": prompt}]
            )

            text = response.content[0].text

            # Parse JSON from response
            start = text.find('{')
            end = text.rfind('}') + 1
            if start != -1 and end > start:
                return json.loads(text[start:end])

        except Exception as e:
            logger.error(f"Analysis failed: {e}")

        return {
            "summary": transcript[:500] + "..." if len(transcript) > 500 else transcript,
            "key_points": [],
            "action_items": []
        }


# Global instance
call_processor = CallProcessor()


async def process_call_background(call_id: int):
    """Background task wrapper for call processing."""
    await call_processor.process_call(call_id)
