from anthropic import AsyncAnthropic
from typing import Optional, List
from ..config import get_settings
from ..models.database import Message

settings = get_settings()


class AnalyzerService:
    def __init__(self):
        self.client = AsyncAnthropic(api_key=settings.anthropic_api_key)
        self.model = "claude-sonnet-4-20250514"

    def _format_messages(self, messages: List[Message]) -> str:
        """Format messages into a readable transcript."""
        lines = []
        for msg in messages:
            name_parts = []
            if msg.first_name:
                name_parts.append(msg.first_name)
            if msg.last_name:
                name_parts.append(msg.last_name)
            name = " ".join(name_parts) if name_parts else "Unknown"

            if msg.username:
                name = f"{name} (@{msg.username})"

            type_indicator = ""
            if msg.message_type == "voice":
                type_indicator = "[голосовое] "
            elif msg.message_type == "video_note":
                type_indicator = "[видео-кружок] "
            elif msg.message_type == "document":
                type_indicator = "[документ] "

            timestamp = msg.created_at.strftime("%Y-%m-%d %H:%M")
            lines.append(f"[{timestamp}] {name}: {type_indicator}{msg.content}")

        return "\n".join(lines)

    def _format_participants(self, participants: List[dict]) -> str:
        """Format participants list for analysis."""
        lines = []
        for p in participants:
            name_parts = []
            if p.get("first_name"):
                name_parts.append(p["first_name"])
            if p.get("last_name"):
                name_parts.append(p["last_name"])
            name = " ".join(name_parts) if name_parts else "Unknown"

            if p.get("username"):
                name = f"{name} (@{p['username']})"

            lines.append(f"- {name}: {p['messages_count']} сообщений")

        return "\n".join(lines)

    async def analyze_chat(
        self,
        messages: List[Message],
        participants: List[dict],
        chat_title: str,
        criteria: Optional[str] = None,
    ) -> str:
        """Perform full analysis of chat messages."""
        if not messages:
            return "В этом чате пока нет сообщений для анализа."

        transcript = self._format_messages(messages)
        participants_info = self._format_participants(participants)

        criteria_text = ""
        if criteria:
            criteria_text = f"""

Особое внимание уделите следующим критериям оценки кандидатов:
{criteria}
"""

        prompt = f"""Ты — HR-аналитик, специализирующийся на оценке кандидатов по их общению в групповых чатах.

Проанализируй переписку из группового чата "{chat_title}" и составь подробный отчёт о каждом участнике как о потенциальном кандидате.

Участники чата:
{participants_info}

Переписка:
---
{transcript}
---
{criteria_text}

Для каждого участника оцени:
1. **Коммуникативные навыки**: ясность изложения, грамотность, умение формулировать мысли
2. **Профессиональные качества**: экспертиза, глубина знаний, качество аргументации
3. **Soft skills**: командная работа, позитивность, конструктивность, эмпатия
4. **Активность и вовлечённость**: частота участия, инициативность
5. **Красные флаги**: негативное поведение, конфликтность, некорректные высказывания

В конце дай общую рекомендацию по каждому кандидату: "Рекомендую", "Рассмотреть", "Не рекомендую" с кратким обоснованием.

Формат ответа: структурированный отчёт с разделами по каждому участнику."""

        response = await self.client.messages.create(
            model=self.model,
            max_tokens=4096,
            messages=[{"role": "user", "content": prompt}],
        )

        return response.content[0].text

    async def ask_question(
        self,
        messages: List[Message],
        question: str,
        chat_title: str,
    ) -> str:
        """Answer a specific question about the chat."""
        if not messages:
            return "В этом чате пока нет сообщений."

        transcript = self._format_messages(messages)

        prompt = f"""Ты — HR-аналитик. У тебя есть доступ к переписке из группового чата "{chat_title}".

Переписка:
---
{transcript}
---

Ответь на вопрос пользователя, основываясь только на информации из переписки.

Вопрос: {question}"""

        response = await self.client.messages.create(
            model=self.model,
            max_tokens=2048,
            messages=[{"role": "user", "content": prompt}],
        )

        return response.content[0].text


analyzer_service = AnalyzerService()
