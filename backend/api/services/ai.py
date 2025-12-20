from typing import List, Optional, AsyncGenerator
from anthropic import AsyncAnthropic
from ..config import get_settings
from ..models.database import Message

settings = get_settings()


class AIService:
    def __init__(self):
        self.client = AsyncAnthropic(api_key=settings.anthropic_api_key)
        self.model = "claude-sonnet-4-20250514"

    def _format_messages(self, messages: List[Message]) -> str:
        lines = []
        for msg in messages:
            name = f"{msg.first_name or ''} {msg.last_name or ''}".strip() or "Unknown"
            if msg.username:
                name = f"{name} (@{msg.username})"

            type_prefix = ""
            if msg.content_type == "voice":
                type_prefix = "[🎤 голосовое] "
            elif msg.content_type == "video_note":
                type_prefix = "[📹 видео] "
            elif msg.content_type == "document":
                type_prefix = f"[📄 {msg.file_name or 'документ'}] "
            elif msg.content_type == "photo":
                type_prefix = "[🖼 фото] "

            ts = msg.timestamp.strftime("%d.%m %H:%M")
            lines.append(f"[{ts}] {name}: {type_prefix}{msg.content}")

        return "\n".join(lines)

    def _format_criteria(self, criteria: List[dict]) -> str:
        if not criteria:
            return ""

        lines = ["Критерии оценки (название | вес 1-10 | описание):"]
        for c in criteria:
            weight = c.get("weight", 5)
            desc = c.get("description", "")
            lines.append(f"- {c['name']} | {weight}/10 | {desc}")
        return "\n".join(lines)

    def _build_system_prompt(self, chat_title: str, messages: List[Message], criteria: List[dict]) -> str:
        transcript = self._format_messages(messages)
        criteria_text = self._format_criteria(criteria)

        return f"""Ты — опытный HR-аналитик, специализирующийся на оценке кандидатов по их общению в групповых чатах.

У тебя есть доступ к переписке из группового чата "{chat_title}".

{criteria_text}

ПЕРЕПИСКА:
---
{transcript}
---

ПРАВИЛА:
1. Отвечай на русском языке
2. Основывайся только на фактах из переписки
3. Приводи конкретные цитаты как доказательства
4. Если информации недостаточно — честно скажи об этом
5. Оценки давай по шкале 1-10 с обоснованием
6. Выделяй red flags и green flags
7. Будь объективен и профессионален"""

    async def chat_stream(
        self,
        user_message: str,
        chat_title: str,
        messages: List[Message],
        criteria: List[dict],
        conversation_history: List[dict],
    ) -> AsyncGenerator[str, None]:
        """Stream response from Claude."""
        system = self._build_system_prompt(chat_title, messages, criteria)

        # Build messages for API
        api_messages = []
        for msg in conversation_history:
            api_messages.append({"role": msg["role"], "content": msg["content"]})
        api_messages.append({"role": "user", "content": user_message})

        async with self.client.messages.stream(
            model=self.model,
            max_tokens=4096,
            system=system,
            messages=api_messages,
        ) as stream:
            async for text in stream.text_stream:
                yield text

    async def quick_action(
        self,
        action: str,
        chat_title: str,
        messages: List[Message],
        criteria: List[dict],
    ) -> AsyncGenerator[str, None]:
        """Handle quick action buttons."""
        prompts = {
            "full_analysis": """Проведи полный HR-анализ всех участников чата.

Для каждого участника оцени:
1. Коммуникативные навыки (1-10)
2. Профессиональные качества (1-10)
3. Soft skills (1-10)
4. Активность и вовлечённость (1-10)

Выдели:
- 🚩 Red flags с цитатами
- ✅ Green flags с цитатами
- 💡 Ключевые наблюдения

В конце дай рекомендацию: Рекомендую / Рассмотреть / Не рекомендую""",

            "red_flags": """Найди все потенциальные red flags в поведении участников:
- Избегание прямых ответов
- Перекладывание ответственности
- Негатив о прошлых работодателях
- Агрессия или конфликтность
- Несоответствия в словах
- Другие тревожные сигналы

Для каждого red flag приведи цитату и объясни, почему это проблема.""",

            "strengths": """Найди сильные стороны каждого участника:
- Профессиональные компетенции
- Коммуникативные навыки
- Лидерские качества
- Инициативность
- Умение работать в команде
- Другие положительные качества

Подкрепи каждое наблюдение конкретными примерами из переписки.""",

            "recommendation": """Дай краткую рекомендацию по каждому участнику:

Формат для каждого:
**Имя участника**
Вердикт: ✅ Рекомендую / ⚠️ Рассмотреть / ❌ Не рекомендую
Причина: [1-2 предложения]
Что уточнить: [вопросы для следующего этапа]"""
        }

        prompt = prompts.get(action, prompts["full_analysis"])

        async for text in self.chat_stream(
            prompt, chat_title, messages, criteria, []
        ):
            yield text

    async def generate_report(
        self,
        chat_title: str,
        messages: List[Message],
        criteria: List[dict],
        report_type: str = "standard",
        include_quotes: bool = True,
    ) -> str:
        """Generate a full report (non-streaming)."""
        style_prompts = {
            "quick": "Краткий отчёт на 1 страницу. Только ключевые выводы, без деталей.",
            "standard": "Стандартный отчёт на 2-3 страницы. Основные выводы с примерами.",
            "detailed": "Подробный отчёт. Детальный анализ каждого аспекта с множеством цитат."
        }

        prompt = f"""Создай HR-отчёт по анализу кандидатов.

Стиль: {style_prompts.get(report_type, style_prompts['standard'])}

Структура отчёта:
1. РЕЗЮМЕ (краткие выводы по каждому участнику)
2. ОЦЕНКИ ПО КРИТЕРИЯМ (таблица с баллами 1-10)
3. RED FLAGS (с цитатами)
4. GREEN FLAGS (с цитатами)
5. РЕКОМЕНДАЦИИ (нанимать/не нанимать/нужно больше данных)
6. ВОПРОСЫ ДЛЯ СЛЕДУЮЩЕГО ЭТАПА

{"Включи ключевые цитаты из переписки." if include_quotes else "Без цитат, только выводы."}

Используй markdown для форматирования."""

        system = self._build_system_prompt(chat_title, messages, criteria)

        response = await self.client.messages.create(
            model=self.model,
            max_tokens=8192,
            system=system,
            messages=[{"role": "user", "content": prompt}],
        )

        return response.content[0].text


ai_service = AIService()
