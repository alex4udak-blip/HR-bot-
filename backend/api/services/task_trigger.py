"""
Auto-creates project tasks from Telegram chat messages.
Triggers on planning-related keywords and uses Claude AI to parse.
"""
import re
import os
import logging
import json
from datetime import datetime
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger("hr-analyzer.task_trigger")

# Trigger words (Russian)
TRIGGER_PATTERNS = [
    r'планиру[юет]',          # планирую, планирует
    r'план на сегодня',
    r'сегодня буду',
    r'собираюсь',
    r'сделаю',
    r'доделаю',
    r'буду работать над',
    r'займусь',
    r'пофикш[уит]',           # пофикшу, пофикшит
    r'исправлю',
    r'нужно сделать',
    r'надо сделать',
    r'буду делать',
    r'закончу',
    r'доработаю',
    r'начну делать',
    r'сегодня:',               # "сегодня: 1. то 2. сё"
    r'good morning',
    r'гуд морнинг',
    r'утренний план',
]

TRIGGER_REGEX = re.compile('|'.join(TRIGGER_PATTERNS), re.IGNORECASE)


def should_trigger(text: str) -> bool:
    """Check if message contains trigger words."""
    return bool(TRIGGER_REGEX.search(text))


async def parse_message_to_tasks(text: str, user_name: str, existing_tasks: list[dict]) -> list[dict]:
    """Use Claude AI to parse a chat message into structured tasks."""
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        logger.warning("ANTHROPIC_API_KEY not set, cannot parse tasks")
        return []

    try:
        import anthropic
    except ImportError:
        logger.warning("anthropic package not installed, cannot parse tasks")
        return []

    try:
        client = anthropic.Anthropic(api_key=api_key)

        existing_str = "\n".join(
            [f"- {t['title']} (status: {t['status']})" for t in existing_tasks[:20]]
        ) or "Нет задач"

        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=1000,
            messages=[{"role": "user", "content": f"""Разбери сообщение из рабочего чата на отдельные задачи.

СООБЩЕНИЕ от {user_name}:
{text}

СУЩЕСТВУЮЩИЕ ЗАДАЧИ В ПРОЕКТЕ:
{existing_str}

Для каждой задачи из сообщения верни JSON объект:
{{
  "title": "Краткое название задачи",
  "description": "Детальное описание из контекста сообщения",
  "priority": 1,
  "estimated_hours": число или null,
  "is_duplicate": true/false (есть ли похожая в существующих)
}}

Верни ТОЛЬКО JSON массив, без markdown."""}],
        )

        ai_text = response.content[0].text.strip()
        if ai_text.startswith("```"):
            ai_text = ai_text.split("```")[1]
            if ai_text.startswith("json"):
                ai_text = ai_text[4:]
            ai_text = ai_text.strip()

        return json.loads(ai_text)
    except Exception as e:
        logger.error(f"AI parse error: {e}")
        return []


async def create_tasks_from_message(
    db: AsyncSession,
    message_text: str,
    user_name: str,
    telegram_user_id: int | None,
    chat_id: int | None,
) -> list[dict]:
    """Full pipeline: detect trigger -> parse -> create tasks -> return results."""
    from ..models.database import (
        Project, ProjectTask, ProjectMember, User, Chat,
    )

    if not should_trigger(message_text):
        return []

    logger.info(f"Task trigger activated for user {user_name}: {message_text[:100]}...")

    # Find user by telegram_id or name
    user = None
    if telegram_user_id:
        result = await db.execute(
            select(User).where(User.telegram_id == telegram_user_id)
        )
        user = result.scalar_one_or_none()

    if not user and user_name:
        result = await db.execute(
            select(User).where(User.name.ilike(f"%{user_name}%"))
        )
        user = result.scalar_one_or_none()

    if not user:
        logger.warning(f"User not found: {user_name} (tg_id={telegram_user_id})")
        return []

    # Find user's projects (where they are a member)
    result = await db.execute(
        select(Project)
        .join(ProjectMember, ProjectMember.project_id == Project.id)
        .where(ProjectMember.user_id == user.id)
        .where(Project.status == 'active')
    )
    projects = list(result.scalars().all())

    if not projects:
        logger.warning(f"No active projects for user {user_name}")
        return []

    # Use first active project (or try to match by chat)
    project = projects[0]

    # If chat is linked to a project, prefer that project
    if chat_id:
        chat_result = await db.execute(
            select(Chat).where(Chat.telegram_chat_id == chat_id)
        )
        chat = chat_result.scalar_one_or_none()
        if chat and chat.entity_id:
            # Try to find project linked to this entity/chat
            for p in projects:
                if p.id == chat.entity_id:
                    project = p
                    break

    # Get existing tasks for duplicate detection
    existing_result = await db.execute(
        select(ProjectTask)
        .where(ProjectTask.project_id == project.id)
        .where(ProjectTask.status.notin_(['done', 'cancelled']))
    )
    existing_tasks = [
        {"title": t.title, "status": t.status if isinstance(t.status, str) else t.status.value}
        for t in existing_result.scalars().all()
    ]

    # Parse message with AI
    parsed_tasks = await parse_message_to_tasks(message_text, user_name, existing_tasks)

    if not parsed_tasks:
        return []

    created = []
    today = datetime.utcnow().replace(hour=23, minute=59, second=59)

    for task_data in parsed_tasks:
        if task_data.get("is_duplicate"):
            continue

        # Increment project task counter
        project.task_counter = (project.task_counter or 0) + 1

        task = ProjectTask(
            project_id=project.id,
            task_number=project.task_counter,
            title=task_data.get("title", "Без названия"),
            description=task_data.get("description"),
            status="todo",
            priority=task_data.get("priority", 1),
            estimated_hours=task_data.get("estimated_hours"),
            assignee_id=user.id,
            due_date=today,
            created_by=user.id,
        )
        db.add(task)

        task_key = f"{project.prefix}-{project.task_counter}" if project.prefix else f"#{project.task_counter}"
        created.append({
            "task_key": task_key,
            "title": task_data.get("title"),
            "assignee": user_name,
            "project": project.name,
        })

    if created:
        await db.commit()
        logger.info(f"Created {len(created)} tasks from chat message by {user_name}")

    return created
