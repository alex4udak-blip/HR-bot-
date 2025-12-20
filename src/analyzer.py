from anthropic import AsyncAnthropic
from typing import Optional
from .database import Message


class AnalyzerService:
    def __init__(self, api_key: str):
        self.client = AsyncAnthropic(api_key=api_key)
        self.model = "claude-sonnet-4-20250514"

    def _format_messages(self, messages: list[Message]) -> str:
        """Format messages into a readable transcript."""
        lines = []
        for msg in messages:
            # Format user name
            name_parts = []
            if msg.first_name:
                name_parts.append(msg.first_name)
            if msg.last_name:
                name_parts.append(msg.last_name)
            name = " ".join(name_parts) if name_parts else "Unknown"

            if msg.username:
                name = f"{name} (@{msg.username})"

            # Format message type indicator
            type_indicator = ""
            if msg.message_type == "voice":
                type_indicator = "[голосовое сообщение] "
            elif msg.message_type == "video_note":
                type_indicator = "[видео-кружок] "
            elif msg.message_type == "document":
                type_indicator = "[документ] "

            # Format timestamp
            timestamp = msg.created_at.strftime("%Y-%m-%d %H:%M")

            lines.append(f"[{timestamp}] {name}: {type_indicator}{msg.content}")

        return "\n".join(lines)

    def _format_users(self, users: list[dict]) -> str:
        """Format users list for analysis."""
        lines = []
        for user in users:
            name_parts = []
            if user["first_name"]:
                name_parts.append(user["first_name"])
            if user["last_name"]:
                name_parts.append(user["last_name"])
            name = " ".join(name_parts) if name_parts else "Unknown"

            if user["username"]:
                name = f"{name} (@{user['username']})"

            lines.append(f"- {name}: {user['message_count']} сообщений")

        return "\n".join(lines)

    async def analyze_chat(
        self,
        messages: list[Message],
        users: list[dict],
        chat_title: str,
        criteria: Optional[str] = None,
    ) -> str:
        """Perform full analysis of chat messages."""
        if not messages:
            return "В этом чате пока нет сообщений для анализа."

        transcript = self._format_messages(messages)
        users_info = self._format_users(users)

        criteria_text = ""
        if criteria:
            criteria_text = f"""

Особое внимание уделите следующим критериям оценки кандидатов:
{criteria}
"""

        prompt = f"""Ты — HR-аналитик, специализирующийся на оценке кандидатов по их общению в групповых чатах.

Проанализируй переписку из группового чата "{chat_title}" и составь подробный отчёт о каждом участнике как о потенциальном кандидате.

Участники чата:
{users_info}

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
        messages: list[Message],
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
