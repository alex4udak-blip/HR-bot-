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
        """Analyze transcript using Claude. Handles long transcripts by chunking."""
        if not self.anthropic:
            logger.warning("Anthropic API key not configured, skipping analysis")
            return {
                "summary": "Analysis not available (API key not configured)",
                "key_points": [],
                "action_items": []
            }

        # For very long transcripts, analyze in chunks and combine
        CHUNK_SIZE = 50000  # Characters per chunk
        MAX_SINGLE_ANALYSIS = 60000  # If less than this, analyze as single piece

        if len(transcript) <= MAX_SINGLE_ANALYSIS:
            # Short transcript - analyze directly
            return await self._analyze_single(transcript)
        else:
            # Long transcript - chunk and combine
            logger.info(f"Long transcript ({len(transcript)} chars), using chunked analysis")
            return await self._analyze_chunked(transcript, CHUNK_SIZE)

    async def _analyze_chunked(self, transcript: str, chunk_size: int) -> dict:
        """Analyze long transcript by splitting into chunks and combining."""
        # Split transcript into chunks
        chunks = []
        for i in range(0, len(transcript), chunk_size):
            chunk = transcript[i:i + chunk_size]
            chunks.append(chunk)

        logger.info(f"Split transcript into {len(chunks)} chunks")

        # Analyze each chunk
        chunk_analyses = []
        for i, chunk in enumerate(chunks):
            logger.info(f"Analyzing chunk {i + 1}/{len(chunks)}")
            chunk_prompt = f"""Проанализируй ЧАСТЬ {i + 1} из {len(chunks)} транскрипта созвона.

ВАЖНО: Это только часть разговора. Извлеки ВСЕ детали из этой части:
- Все обсуждаемые темы и подтемы
- Все упомянутые требования, характеристики, критерии
- Все имена, цифры, примеры
- Все идеи и предложения
- Все договорённости и задачи

Часть транскрипта:
---
{chunk}
---

Ответь JSON:
{{
  "topics": ["тема 1", "тема 2", ...],
  "details": ["важная деталь 1", "важная деталь 2", ...],
  "key_points": ["ключевой момент 1", "ключевой момент 2", ...],
  "action_items": ["задача 1", "задача 2", ...],
  "profiles": ["если обсуждались роли/кандидаты - все характеристики"],
  "decisions": ["решение 1", "решение 2", ...],
  "open_questions": ["нерешённый вопрос 1", ...]
}}"""

            try:
                response = await self.anthropic.messages.create(
                    model="claude-sonnet-4-20250514",
                    max_tokens=8000,
                    messages=[{"role": "user", "content": chunk_prompt}]
                )
                text = response.content[0].text
                start = text.find('{')
                end = text.rfind('}') + 1
                if start != -1 and end > start:
                    chunk_analyses.append(json.loads(text[start:end]))
            except Exception as e:
                logger.error(f"Chunk {i + 1} analysis failed: {e}")

        # Combine all chunk analyses into final analysis
        return await self._combine_chunk_analyses(chunk_analyses, len(transcript))

    async def _combine_chunk_analyses(self, chunk_analyses: list, total_length: int) -> dict:
        """Combine multiple chunk analyses into a final comprehensive analysis."""
        if not chunk_analyses:
            return {"summary": "Analysis failed", "key_points": [], "action_items": []}

        # Collect all data from chunks
        all_topics = []
        all_details = []
        all_key_points = []
        all_action_items = []
        all_profiles = []
        all_decisions = []
        all_open_questions = []

        for analysis in chunk_analyses:
            all_topics.extend(analysis.get("topics", []))
            all_details.extend(analysis.get("details", []))
            all_key_points.extend(analysis.get("key_points", []))
            all_action_items.extend(analysis.get("action_items", []))
            all_profiles.extend(analysis.get("profiles", []))
            all_decisions.extend(analysis.get("decisions", []))
            all_open_questions.extend(analysis.get("open_questions", []))

        # Now create final synthesis
        synthesis_prompt = f"""На основе анализа ВСЕХ частей длинного созвона ({total_length} символов, {len(chunk_analyses)} частей), создай ФИНАЛЬНЫЙ ИСЧЕРПЫВАЮЩИЙ анализ.

Собранные данные из всех частей:

ТЕМЫ: {json.dumps(all_topics, ensure_ascii=False)}

ДЕТАЛИ: {json.dumps(all_details[:100], ensure_ascii=False)}

КЛЮЧЕВЫЕ МОМЕНТЫ: {json.dumps(all_key_points, ensure_ascii=False)}

ЗАДАЧИ: {json.dumps(all_action_items, ensure_ascii=False)}

ПРОФИЛИ/РОЛИ: {json.dumps(all_profiles, ensure_ascii=False)}

РЕШЕНИЯ: {json.dumps(all_decisions, ensure_ascii=False)}

ОТКРЫТЫЕ ВОПРОСЫ: {json.dumps(all_open_questions, ensure_ascii=False)}

Создай ФИНАЛЬНЫЙ структурированный анализ:

## SUMMARY:

**СУТЬ РАЗГОВОРА** (2-3 предложения):
Главная цель и ключевой результат встречи.

**ОСНОВНАЯ ТЕМА:**
Детальное описание главной темы.

**ПОДТЕМЫ** (все что обсуждалось):
Перечисли ВСЕ подтемы с кратким описанием каждой.

**ДЕТАЛЬНЫЕ РАЗБОРЫ ТЕМ:**
Для каждой важной темы/роли/проекта:
- Какие требования/характеристики назывались
- Какие идеи предлагались
- Какие примеры приводились

**К ЧЕМУ ПРИШЛИ (договорённости):**
ВСЕ решения и договорённости.

**К ЧЕМУ НЕ ПРИШЛИ (открытые вопросы):**
Что осталось нерешённым.

**ПОРТРЕТЫ И ПРОФИЛИ:**
Если обсуждались требования к ролям - ВСЕ характеристики:
- Hard skills, Soft skills, Опыт, Личные качества

**ИНСАЙТЫ И ВЫВОДЫ:**
Наблюдения, риски, возможности.

**ОБЩАЯ ОЦЕНКА:**
Продуктивность встречи.

Ответь ТОЛЬКО JSON:
{{
  "summary": "Полное форматированное резюме со ВСЕМИ разделами",
  "key_points": ["15-25 ключевых моментов с деталями"],
  "action_items": ["все задачи"]
}}"""

        try:
            response = await self.anthropic.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=16000,
                messages=[{"role": "user", "content": synthesis_prompt}]
            )
            text = response.content[0].text
            start = text.find('{')
            end = text.rfind('}') + 1
            if start != -1 and end > start:
                return json.loads(text[start:end])
        except Exception as e:
            logger.error(f"Synthesis failed: {e}")

        # Fallback: just concatenate key points
        return {
            "summary": f"Длинный созвон ({total_length} символов). Темы: " + ", ".join(all_topics[:10]),
            "key_points": all_key_points[:25],
            "action_items": all_action_items[:15]
        }

    async def _analyze_single(self, transcript: str) -> dict:
        """Analyze a single (short) transcript."""
        prompt = f"""Ты опытный бизнес-аналитик с безупречным вниманием к деталям. Твоя задача - создать ИСЧЕРПЫВАЮЩИЙ анализ созвона.

КРИТИЧЕСКИ ВАЖНО:
- Прочитай ВЕСЬ транскрипт от начала до конца
- Извлеки ВСЕ конкретные детали, идеи, требования, характеристики
- Если обсуждались портреты людей/ролей - опиши ВСЕ упомянутые характеристики
- Не упускай детали из любой части транскрипта (начало, середина, конец)
- Лучше добавить больше деталей, чем упустить важное

Создай анализ по структуре:

## SUMMARY:

**СУТЬ РАЗГОВОРА** (2-3 предложения):
Главная цель и ключевой результат встречи.

**ОСНОВНАЯ ТЕМА:**
Детальное описание главной темы.

**ПОДТЕМЫ** (все что обсуждалось):
Перечисли ВСЕ подтемы с кратким описанием каждой.

**ДЕТАЛЬНЫЕ РАЗБОРЫ ТЕМ:**
Для каждой важной темы/роли/проекта что обсуждались подробно:
- Какие требования/характеристики назывались
- Какие идеи предлагались
- Какие примеры приводились
- Какие критерии определяли

**К ЧЕМУ ПРИШЛИ (договорённости):**
ВСЕ решения и договорённости, даже предварительные.

**К ЧЕМУ НЕ ПРИШЛИ (открытые вопросы):**
Что осталось нерешённым и требует дальнейшего обсуждения.

**ПОРТРЕТЫ И ПРОФИЛИ:**
Если обсуждались требования к кандидатам, ролям, сотрудникам - выпиши ВСЕ характеристики:
- Hard skills
- Soft skills
- Опыт
- Личные качества
- Что должен уметь делать
- Примеры из обсуждения

**ИНСАЙТЫ И ВЫВОДЫ:**
- Скрытые паттерны и наблюдения
- Риски и возможности
- Что читается между строк
- Динамика общения участников

**ОБЩАЯ ОЦЕНКА:**
Продуктивность встречи и рекомендации.

## KEY_POINTS (15-25 ключевых моментов):
Каждый пункт КОНКРЕТНЫЙ с деталями, именами, цифрами, примерами.
Охвати ВСЕ части разговора - начало, середину и конец!

## ACTION_ITEMS:
Все задачи с ответственными и сроками.

Транскрипт:
---
{transcript}
---

Ответь ТОЛЬКО валидным JSON:
{{
  "summary": "Полное форматированное резюме со ВСЕМИ разделами (используй **жирный** для заголовков, \\n для переносов)",
  "key_points": ["Детальный пункт 1", "Детальный пункт 2", ...],
  "action_items": ["Задача: кто, что, когда", ...]
}}"""

        try:
            response = await self.anthropic.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=16000,
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
