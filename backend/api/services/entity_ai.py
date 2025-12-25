"""
Entity AI Service - AI assistant for Entity (contact card) analysis.

Provides:
- Quick actions: full_analysis, red_flags, comparison, prediction, summary, questions
- Free-form chat about the entity based on all linked chats and calls
- Streaming responses

Optimizations:
- Prompt Caching: 90% savings on repeated system prompts
- Smart truncate: Reduce token usage while preserving context
- Hash-based caching for quick actions
"""
from typing import List, AsyncGenerator, Optional
from anthropic import AsyncAnthropic
import logging

from ..config import get_settings
from ..models.database import Entity, Chat, Message, CallRecording
from .cache import cache_service, smart_truncate, format_messages_optimized
from .participants import identify_participants_from_objects, format_participant_list

logger = logging.getLogger("hr-analyzer.entity-ai")

settings = get_settings()

# Quick action prompts
ENTITY_QUICK_ACTIONS = {
    "full_analysis": """Проведи полный анализ этого контакта на основе ВСЕХ доступных данных:

1. **Общий портрет** — кто этот человек, его сильные и слабые стороны
2. **Стиль коммуникации** — как общается, насколько активен, особенности (включая чувство юмора, если есть)
3. **Red flags** 🚩 — РЕАЛЬНЫЕ тревожные сигналы с конкретными цитатами (юмор, сарказм и шутки — НЕ red flags!)
4. **Green flags** ✅ — позитивные моменты с конкретными цитатами
5. **Динамика поведения** — как менялось поведение со временем
6. **Прогноз успеха** — оценка 0-100% с подробным обоснованием
7. **Рекомендации** — что делать дальше, на что обратить внимание

⚠️ Различай юмор/иронию от реальных проблем. Не путай шутки с red flags.""",

    "red_flags": """Найди ВСЕ red flags (тревожные сигналы) по этому контакту из всех чатов и звонков.

Для каждого red flag укажи:
🚩 **Описание проблемы** — что именно настораживает
📝 **Цитата/пример** — конкретные слова или действия
⚠️ **Уровень риска** — низкий/средний/высокий
💡 **Рекомендация** — как с этим работать

ВАЖНО — НЕ считай red flags:
- Юмор, шутки, сарказм — это нормальная часть общения
- Неформальный стиль, сленг, эмодзи
- Дружелюбную иронию или самоиронию
- Разговорные выражения

Различай контекст: если что-то сказано в шутку или с иронией — это НЕ red flag.
Будь объективен — не придумывай проблемы, если их нет.""",

    "comparison": """Сравни поведение контакта ДО и ПОСЛЕ ключевых этапов (найма, сделки, начала работы):

**ДО:**
- Стиль общения
- Обещания и ожидания
- Уровень активности и вовлечённости

**ПОСЛЕ:**
- Реальное поведение
- Выполнение обещаний
- Изменения в коммуникации

📊 **Совпадение ожиданий:** X%
⚠️ **Главные расхождения** (если есть)
💡 **Рекомендации**

Если данных для сравнения недостаточно — укажи это.""",

    "prediction": """Спрогнозируй успешность работы с этим контактом:

📊 **Прогноз успеха:** X%

**Факторы "за" ✅**
- (перечисли позитивные факторы)

**Факторы "против" ❌**
- (перечисли негативные факторы)

**Основные риски ⚠️**
- (перечисли риски)

**Итоговая рекомендация:**
(одним абзацем — что делать)""",

    "summary": """Дай краткое резюме по контакту:

👤 **Имя:** [имя]
📊 **Статус:** [текущий статус]
⭐ **Общая оценка:** X/10

**Три главных плюса:**
1. ...
2. ...
3. ...

**Три главных минуса:**
1. ...
2. ...
3. ...

🚩 **Главный риск:** (одним предложением)

💡 **Рекомендация:** (одним предложением)""",

    "questions": """Подготовь вопросы для следующей встречи/разговора с этим контактом:

**1. Уточняющие вопросы** (что нужно прояснить)
- ...

**2. Проверочные вопросы** (проверить red flags)
- ...

**3. Развивающие вопросы** (раскрыть потенциал)
- ...

**4. Критические вопросы** (для принятия решения)
- ...

Вопросы должны быть конкретными и основанными на данных из переписок/звонков."""
}


class EntityAIService:
    """AI service for Entity analysis with streaming support"""

    def __init__(self):
        self._client: Optional[AsyncAnthropic] = None
        self.model = "claude-sonnet-4-20250514"

    @property
    def client(self) -> AsyncAnthropic:
        if self._client is None:
            if not settings.anthropic_api_key:
                raise ValueError("ANTHROPIC_API_KEY не настроен")
            self._client = AsyncAnthropic(api_key=settings.anthropic_api_key)
        return self._client

    def _build_entity_context(
        self,
        entity: Entity,
        chats: List[Chat],
        calls: List[CallRecording]
    ) -> str:
        """Build comprehensive context about the entity from all sources"""
        parts = []

        # Basic entity info
        parts.append(f"""## Контакт: {entity.name}
- **Тип:** {entity.type.value}
- **Статус:** {entity.status.value}
- **Компания:** {entity.company or 'Не указана'}
- **Должность:** {entity.position or 'Не указана'}
- **Email:** {entity.email or 'Не указан'}
- **Телефон:** {entity.phone or 'Не указан'}
- **Теги:** {', '.join(entity.tags) if entity.tags else 'Нет'}
""")

        # All linked chats with messages (optimized with smart truncate and participant roles)
        if chats:
            parts.append("\n## ПЕРЕПИСКИ:")
            for chat in chats:
                parts.append(f"\n### Чат: {chat.custom_name or chat.title} ({chat.chat_type.value})")
                if hasattr(chat, 'messages') and chat.messages:
                    # Get last 100 messages to avoid context overflow
                    messages = sorted(chat.messages, key=lambda m: m.timestamp)[-100:]

                    # Identify participants for this chat
                    participants = identify_participants_from_objects(chat, messages, use_ai_fallback=False)

                    # Add participant list
                    if participants:
                        parts.append(format_participant_list(participants))

                    # Format messages with role icons
                    formatted_messages = format_messages_optimized(messages, max_per_message=400, participants=participants)
                    if formatted_messages:
                        parts.append(formatted_messages)
                else:
                    parts.append("(нет сообщений)")

        # All linked calls with transcripts
        if calls:
            parts.append("\n## ЗВОНКИ:")
            for call in calls:
                call_date = call.created_at.strftime('%d.%m.%Y') if call.created_at else "дата неизвестна"
                parts.append(f"\n### Звонок от {call_date}")
                if call.title:
                    parts.append(f"**Название:** {call.title}")
                if call.duration_seconds:
                    mins = call.duration_seconds // 60
                    secs = call.duration_seconds % 60
                    parts.append(f"**Длительность:** {mins}м {secs}с")
                if call.summary:
                    parts.append(f"**Саммари:** {call.summary}")
                if call.key_points:
                    parts.append("**Ключевые моменты:**")
                    for point in call.key_points[:10]:
                        parts.append(f"- {point}")
                if call.transcript:
                    # Limit transcript to avoid context overflow
                    transcript = call.transcript[:5000]
                    if len(call.transcript) > 5000:
                        transcript += "\n... (транскрипт обрезан)"
                    parts.append(f"**Транскрипт:**\n{transcript}")

        if not chats and not calls:
            parts.append("\n⚠️ К этому контакту пока не привязаны чаты или звонки.")

        return "\n".join(parts)

    def _build_system_prompt(self, entity_context: str) -> str:
        """Build system prompt with entity context"""
        return f"""Ты — AI-ассистент для HR-аналитики. У тебя есть полные данные о контакте:
все переписки из Telegram и все записи звонков.

{entity_context}

ПРАВИЛА:
1. Отвечай на русском языке
2. Основывайся ТОЛЬКО на фактах из предоставленных данных
3. Приводи конкретные цитаты из переписок/звонков где возможно
4. Если информации недостаточно — честно скажи об этом
5. Будь объективен и профессионален
6. Используй форматирование markdown для структурирования ответа
7. Не придумывай факты — работай только с тем, что есть
8. ВАЖНО: Различай юмор, сарказм, шутки от серьёзных проблем. Неформальный стиль общения — это нормально, не считай его за red flag
9. Понимай контекст: дружелюбная ирония, мемы, сленг — это часть современной коммуникации"""

    async def chat_stream(
        self,
        user_message: str,
        entity: Entity,
        chats: List[Chat],
        calls: List[CallRecording],
        conversation_history: List[dict]
    ) -> AsyncGenerator[str, None]:
        """
        Stream AI response for chat with Prompt Caching.

        Prompt Caching provides 90% cost reduction on cached system prompts.
        """
        context = self._build_entity_context(entity, chats, calls)
        system_text = self._build_system_prompt(context)

        # Use Prompt Caching for system prompt (90% savings!)
        system = [
            {
                "type": "text",
                "text": system_text,
                "cache_control": {"type": "ephemeral"}
            }
        ]

        # Build messages for API (limit history to last 20 exchanges to avoid token overflow)
        # 20 exchanges = 40 messages (user + assistant pairs)
        MAX_HISTORY_MESSAGES = 40
        limited_history = conversation_history[-MAX_HISTORY_MESSAGES:] if len(conversation_history) > MAX_HISTORY_MESSAGES else conversation_history

        api_messages = []
        for msg in limited_history:
            api_messages.append({
                "role": msg["role"],
                "content": msg["content"]
            })
        api_messages.append({
            "role": "user",
            "content": user_message
        })

        logger.info(f"Entity AI chat for entity {entity.id}, {len(chats)} chats, {len(calls)} calls")

        try:
            async with self.client.messages.stream(
                model=self.model,
                max_tokens=4096,
                system=system,
                messages=api_messages
            ) as stream:
                async for text in stream.text_stream:
                    yield text
        except Exception as e:
            logger.error(f"Entity AI streaming error: {e}")
            raise

    async def quick_action(
        self,
        action: str,
        entity: Entity,
        chats: List[Chat],
        calls: List[CallRecording]
    ) -> AsyncGenerator[str, None]:
        """Execute quick action and stream response"""
        prompt = ENTITY_QUICK_ACTIONS.get(action)
        if not prompt:
            yield f"Неизвестное действие: {action}"
            return

        logger.info(f"Entity AI quick action '{action}' for entity {entity.id}")

        async for text in self.chat_stream(prompt, entity, chats, calls, []):
            yield text

    def get_available_actions(self) -> List[dict]:
        """Get list of available quick actions"""
        return [
            {"id": "full_analysis", "label": "Полный анализ", "icon": "file-search"},
            {"id": "red_flags", "label": "Red flags", "icon": "alert-triangle"},
            {"id": "comparison", "label": "До/После", "icon": "git-compare"},
            {"id": "prediction", "label": "Прогноз", "icon": "trending-up"},
            {"id": "summary", "label": "Резюме", "icon": "file-text"},
            {"id": "questions", "label": "Вопросы", "icon": "help-circle"},
        ]


# Singleton instance
entity_ai_service = EntityAIService()
