"""
Entity AI Service - AI assistant for Entity (contact card) analysis.

Provides:
- Quick actions: full_analysis, red_flags, comparison, prediction, summary, questions
- Free-form chat about the entity based on all linked chats and calls
- Streaming responses
"""
from typing import List, AsyncGenerator, Optional
from anthropic import AsyncAnthropic
import logging

from ..config import get_settings
from ..models.database import Entity, Chat, Message, CallRecording

logger = logging.getLogger("hr-analyzer.entity-ai")

settings = get_settings()

# Quick action prompts
ENTITY_QUICK_ACTIONS = {
    "full_analysis": """Проведи полный анализ этого контакта на основе ВСЕХ доступных данных:

1. **Общий портрет** — кто этот человек, его сильные и слабые стороны
2. **Стиль коммуникации** — как общается, насколько активен, особенности
3. **Red flags** 🚩 — тревожные сигналы с конкретными цитатами
4. **Green flags** ✅ — позитивные моменты с конкретными цитатами
5. **Динамика поведения** — как менялось поведение со временем
6. **Прогноз успеха** — оценка 0-100% с подробным обоснованием
7. **Рекомендации** — что делать дальше, на что обратить внимание""",

    "red_flags": """Найди ВСЕ red flags (тревожные сигналы) по этому контакту из всех чатов и звонков.

Для каждого red flag укажи:
🚩 **Описание проблемы** — что именно настораживает
📝 **Цитата/пример** — конкретные слова или действия
⚠️ **Уровень риска** — низкий/средний/высокий
💡 **Рекомендация** — как с этим работать

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
        """Build comprehensive context about the entity from all sources.

        IMPORTANT: Identifies which messages/statements belong to the CONTACT
        vs other participants using telegram_user_id matching.
        """
        parts = []

        # Basic entity info with identity markers
        entity_names = [entity.name]
        if entity.telegram_user_id:
            entity_names.append(f"Telegram ID: {entity.telegram_user_id}")

        parts.append(f"""## 📋 АНАЛИЗИРУЕМЫЙ КОНТАКТ: {entity.name}

**ВАЖНО:** Все сообщения и высказывания этого контакта помечены как **[КОНТАКТ]**.
Остальные участники помечены как [Другой участник].

### Данные контакта:
- **Тип:** {entity.type.value}
- **Статус:** {entity.status.value}
- **Компания:** {entity.company or 'Не указана'}
- **Должность:** {entity.position or 'Не указана'}
- **Email:** {entity.email or 'Не указан'}
- **Телефон:** {entity.phone or 'Не указан'}
- **Теги:** {', '.join(entity.tags) if entity.tags else 'Нет'}
- **Telegram:** {'@' + entity.telegram_username if entity.telegram_username else 'Не указан'} (ID: {entity.telegram_user_id or 'Не указан'})
""")

        # Helper to check if message is from the contact
        def is_contact_message(msg: Message) -> bool:
            """Check if message is from the analyzed contact.

            Priority:
            1. telegram_user_id exact match (most reliable)
            2. telegram_username match (@username)
            3. Name similarity match (fallback)
            """
            # Priority 1: telegram_user_id exact match
            if entity.telegram_user_id and msg.telegram_user_id:
                return msg.telegram_user_id == entity.telegram_user_id

            # Priority 2: telegram_username match
            if entity.telegram_username and msg.username:
                entity_username = entity.telegram_username.lower().lstrip('@')
                msg_username = msg.username.lower().lstrip('@')
                if entity_username == msg_username:
                    return True

            # Priority 3: Name similarity match (fallback)
            msg_name = f"{msg.first_name or ''} {msg.last_name or ''}".strip().lower()
            entity_name = entity.name.lower() if entity.name else ""
            return entity_name and msg_name and (
                entity_name in msg_name or msg_name in entity_name
            )

        # All linked chats with messages - NO LIMIT
        if chats:
            parts.append("\n## 💬 ПЕРЕПИСКИ:")
            total_contact_messages = 0
            total_other_messages = 0

            for chat in chats:
                parts.append(f"\n### Чат: {chat.custom_name or chat.title} ({chat.chat_type.value})")
                if hasattr(chat, 'messages') and chat.messages:
                    # Sort by timestamp, NO LIMIT
                    messages = sorted(chat.messages, key=lambda m: m.timestamp)

                    for msg in messages:
                        is_contact = is_contact_message(msg)
                        sender_label = "**[КОНТАКТ]**" if is_contact else "[Другой участник]"

                        if is_contact:
                            total_contact_messages += 1
                        else:
                            total_other_messages += 1

                        name = f"{msg.first_name or ''} {msg.last_name or ''}".strip() or msg.username or "Unknown"
                        ts = msg.timestamp.strftime("%d.%m %H:%M") if msg.timestamp else ""

                        # Content type indicator
                        if msg.content_type == "voice":
                            content = f"[🎤 Голосовое] {msg.content}" if msg.content else "[🎤 Голосовое сообщение]"
                        elif msg.content_type == "video_note":
                            content = f"[📹 Видеокружок] {msg.content}" if msg.content else "[📹 Видеокружок]"
                        elif msg.content_type == "document":
                            content = f"[📎 Документ: {msg.file_name}] {msg.content}" if msg.content else f"[📎 Документ: {msg.file_name or 'файл'}]"
                        elif msg.content_type == "photo":
                            content = f"[🖼 Фото] {msg.content}" if msg.content else "[🖼 Фото]"
                        else:
                            content = msg.content or "[медиа]"

                        parts.append(f"[{ts}] {sender_label} {name}: {content}")
                else:
                    parts.append("(нет сообщений)")

            parts.append(f"\n📊 **Статистика переписок:** {total_contact_messages} сообщений от КОНТАКТА, {total_other_messages} от других участников")

        # All linked calls with FULL transcripts
        if calls:
            parts.append("\n## 📞 ЗВОНКИ:")
            for call in calls:
                call_date = call.created_at.strftime('%d.%m.%Y %H:%M') if call.created_at else "дата неизвестна"
                parts.append(f"\n### Звонок от {call_date}")
                if call.title:
                    parts.append(f"**Название:** {call.title}")
                if call.duration_seconds:
                    mins = call.duration_seconds // 60
                    secs = call.duration_seconds % 60
                    parts.append(f"**Длительность:** {mins}м {secs}с")

                # Speakers info - identify the contact
                def is_contact_speaker(speaker_info) -> bool:
                    """Check if speaker is the analyzed contact by name or email."""
                    if isinstance(speaker_info, dict):
                        speaker_name = speaker_info.get("speaker", "").lower()
                        speaker_email = speaker_info.get("email", "").lower()
                    else:
                        speaker_name = str(speaker_info).lower()
                        speaker_email = ""

                    # Check by email (most reliable for calls)
                    if entity.email and speaker_email:
                        if entity.email.lower() == speaker_email:
                            return True

                    # Check by name
                    if entity.name:
                        entity_name = entity.name.lower()
                        if entity_name in speaker_name or speaker_name in entity_name:
                            return True
                        # Also check first/last name parts
                        name_parts = entity_name.split()
                        for part in name_parts:
                            if len(part) > 2 and part in speaker_name:
                                return True

                    return False

                if call.speakers:
                    parts.append("**Участники:**")
                    for speaker in call.speakers if isinstance(call.speakers, list) else []:
                        speaker_name = speaker.get("speaker", "Unknown") if isinstance(speaker, dict) else str(speaker)
                        label = " **[КОНТАКТ]**" if is_contact_speaker(speaker) else ""
                        parts.append(f"- {speaker_name}{label}")

                if call.summary:
                    parts.append(f"\n**📝 Резюме звонка:**\n{call.summary}")

                if call.key_points:
                    parts.append("\n**🎯 Ключевые моменты:**")
                    for point in call.key_points:
                        parts.append(f"- {point}")

                if call.action_items:
                    parts.append("\n**✅ Action items:**")
                    for item in call.action_items:
                        parts.append(f"- {item}")

                if call.transcript:
                    # FULL TRANSCRIPT - no limit
                    parts.append(f"\n**📜 Полный транскрипт:**\n{call.transcript}")

        if not chats and not calls:
            parts.append("\n⚠️ К этому контакту пока не привязаны чаты или звонки.")

        return "\n".join(parts)

    def _build_system_prompt(self, entity_context: str) -> str:
        """Build system prompt with entity context"""
        return f"""Ты — AI-ассистент для HR-аналитики. У тебя есть ПОЛНЫЕ данные о контакте:
все переписки из Telegram и все записи звонков.

{entity_context}

## КРИТИЧЕСКИ ВАЖНО — ИДЕНТИФИКАЦИЯ КОНТАКТА:
- Сообщения анализируемого контакта помечены как **[КОНТАКТ]**
- Сообщения других участников помечены как [Другой участник]
- НИКОГДА не путай высказывания контакта с высказываниями других людей
- Когда цитируешь контакта — бери ТОЛЬКО сообщения с меткой [КОНТАКТ]
- В звонках участники тоже помечены, где возможно идентифицировать

## ПРАВИЛА АНАЛИЗА:
1. Отвечай на русском языке
2. Основывайся ТОЛЬКО на фактах из предоставленных данных
3. Приводи конкретные цитаты из переписок/звонков — указывай дату и кто сказал
4. ВСЕГДА различай что сказал КОНТАКТ vs что сказали ДРУГИЕ о контакте
5. Если информации недостаточно — честно скажи об этом
6. Будь объективен и профессионален
7. Используй форматирование markdown для структурирования ответа
8. Не придумывай факты — работай только с тем, что есть
9. При анализе red/green flags — цитируй ИМЕННО слова контакта, а не других"""

    async def chat_stream(
        self,
        user_message: str,
        entity: Entity,
        chats: List[Chat],
        calls: List[CallRecording],
        conversation_history: List[dict]
    ) -> AsyncGenerator[str, None]:
        """Stream AI response for chat"""
        context = self._build_entity_context(entity, chats, calls)
        system = self._build_system_prompt(context)

        # Build messages for API
        api_messages = []
        for msg in conversation_history:
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
