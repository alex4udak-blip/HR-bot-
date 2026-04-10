"""
Auto-creates project tasks from Telegram chat messages.
Triggers on planning-related keywords and uses Claude AI to parse.
Also detects status reports and updates project progress.
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
    # Прямая постановка задачи (все формы слова "задача")
    r'задач[уаие]',               # задача, задачу, задачи, задаче
    r'ставлю задач',
    r'создай задач',
    r'новая задач',
    r'таск[:\s]',
    r'todo[:\s]',
    # Планирование (все формы)
    r'планиру[юет]',
    r'план на',
    r'буду.*делать',              # "буду сегодня делать" — слова могут быть через другие
    r'буду.*работать',
    r'буду.*сделать',
    r'хочу.*сделать',             # "хочу сделать кнопку"
    r'хочу.*делать',
    r'собираюсь',
    r'сделаю',
    r'доделаю',
    r'займусь',
    r'пофикш',
    r'исправлю',
    r'нужно.*сделать',
    r'нужно.*делать',
    r'надо.*сделать',
    r'надо.*делать',
    r'закончу',
    r'доработаю',
    r'начну делать',
    r'начну работать',
    r'сегодня:',
    r'сегодня буду',
    r'good morning',
    r'гуд морнинг',
    r'утренний план',
]

TRIGGER_REGEX = re.compile('|'.join(TRIGGER_PATTERNS), re.IGNORECASE)


def should_trigger(text: str) -> bool:
    """Check if message contains trigger words."""
    return bool(TRIGGER_REGEX.search(text))


# ---------------------------------------------------------------------------
# Status report detection & parsing
# ---------------------------------------------------------------------------

STATUS_PATTERNS = [
    r'статус.*проект',           # "статус по проектам"
    r'готовность\s*\d+',         # "готовность 90%"
    r'статус[:\s]',              # "статус:"
    r'\d+%\s*(готов|готовность)', # "90% готово"
    r'статус.?отч[её]т',        # "статус-отчёт" / "статус отчет"
    r'status\s*report',
]
STATUS_REGEX = re.compile('|'.join(STATUS_PATTERNS), re.IGNORECASE)


def is_status_report(text: str) -> bool:
    """Check if message is a status report (not a task).

    A status report typically lists several projects with progress percentages
    or completion markers. We require the pattern match plus at least one
    line that looks like a project-progress entry (contains ``%`` or a
    completion keyword).
    """
    if not STATUS_REGEX.search(text):
        return False
    # Extra heuristic: message should contain at least one percentage or
    # a completion keyword on a separate line to avoid false positives.
    pct_or_done = re.compile(r'\d+\s*%|завершён|завершен|done|готов[оа]?\b', re.IGNORECASE)
    return bool(pct_or_done.search(text))


async def parse_status_report(text: str) -> list[dict]:
    """Use Claude AI to extract project names and progress from a status report."""
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        logger.warning("ANTHROPIC_API_KEY not set, cannot parse status report")
        return []

    try:
        import anthropic
    except ImportError:
        logger.warning("anthropic package not installed, cannot parse status report")
        return []

    try:
        client = anthropic.Anthropic(api_key=api_key)

        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=1000,
            messages=[{"role": "user", "content": f"""Разбери статус-отчёт по проектам. Извлеки название проекта и процент готовности.

ТЕКСТ:
{text}

Для каждого проекта верни JSON:
{{
  "project_name": "название проекта",
  "progress_percent": число 0-100 (если указан диапазон — среднее),
  "status_text": "текст статуса если есть" или null,
  "is_completed": true/false (если написано "завершён/готов/done")
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
        logger.error(f"AI status report parse error: {e}")
        return []


async def update_projects_from_status(
    db: AsyncSession,
    message_text: str,
    user_name: str,
    telegram_user_id: int | None,
    chat_id: int | None = None,
) -> list[dict]:
    """Parse status report and update project progress in the database.

    Returns a list of dicts describing which projects were updated, or an
    empty list if the message is not a status report or nothing matched.
    """
    from ..models.database import Project, User, OrgMember, Chat

    if not is_status_report(message_text):
        return []

    logger.info(f"Status report detected from {user_name}")

    # Find user by telegram_id
    user = None
    if telegram_user_id:
        result = await db.execute(select(User).where(User.telegram_id == telegram_user_id))
        user = result.scalar_one_or_none()

    if not user and user_name:
        result = await db.execute(select(User).where(User.name.ilike(f"%{user_name}%")))
        user = result.scalar_one_or_none()

    # Find org — from user or from chat
    org_id = None
    if user:
        org_result = await db.execute(select(OrgMember.org_id).where(OrgMember.user_id == user.id).limit(1))
        org_id = org_result.scalar_one_or_none()

    # Fallback: get org from the chat
    if not org_id and chat_id:
        chat_result = await db.execute(select(Chat).where(Chat.telegram_chat_id == chat_id))
        chat_obj = chat_result.scalar_one_or_none()
        if chat_obj and chat_obj.org_id:
            org_id = chat_obj.org_id

    if not org_id:
        logger.warning(f"Status report: no org found for {user_name} (tg_id={telegram_user_id})")
        return []

    # Get all projects in the organisation
    projects_result = await db.execute(
        select(Project).where(Project.org_id == org_id)
    )
    all_projects = list(projects_result.scalars().all())

    if not all_projects:
        logger.warning(f"Status report: no projects in org for user {user_name}")
        return []

    # Parse status report with AI
    parsed = await parse_status_report(message_text)
    if not parsed:
        return []

    updated: list[dict] = []
    for item in parsed:
        project_name = item.get("project_name", "")
        progress = item.get("progress_percent")
        is_completed = item.get("is_completed", False)

        # Fuzzy match: substring in either direction
        matched_project = None
        for p in all_projects:
            if project_name.lower() in p.name.lower() or p.name.lower() in project_name.lower():
                matched_project = p
                break

        if not matched_project:
            logger.debug(f"Status report: no project matched for '{project_name}'")
            continue

        # Update progress
        if progress is not None:
            matched_project.progress_percent = int(progress)
            matched_project.progress_mode = "manual"

        if is_completed:
            matched_project.status = "completed"
            matched_project.progress_percent = 100
            matched_project.completed_at = datetime.utcnow()

        updated.append({
            "project_name": matched_project.name,
            "progress": matched_project.progress_percent,
            "status": "completed" if is_completed else (
                matched_project.status if isinstance(matched_project.status, str)
                else matched_project.status.value
            ),
        })

    if updated:
        await db.commit()
        logger.info(f"Updated {len(updated)} projects from status report by {user_name}")

    return updated


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
  "priority": 0-3 (0=низкий, 1=нормальный, 2=высокий, 3=критический),
  "estimated_hours": число или null,
  "is_duplicate": true/false (есть ли похожая в существующих),
  "assignee_name": "имя человека если указано в тексте, ОБЯЗАТЕЛЬНО В ИМЕНИТЕЛЬНОМ ПАДЕЖЕ (например 'Диме нужно' → 'Дима', 'для Миши' → 'Миша', 'на Клима' → 'Клим')" или null,
  "project_hint": "название проекта если указано (например 'по проекту Platform')" или null,
  "deadline_hint": "когда дедлайн если указано (сегодня/завтра/дата)" или "сегодня"
}}

Правила:
- Извлекай ТОЛЬКО рабочие задачи, связанные с разработкой/проектами/работой
- ИГНОРИРУЙ бытовые дела (помыть посуду, сходить в магазин, приготовить обед, погулять и т.д.)
- ИГНОРИРУЙ шутки, мемы, разговоры не по работе
- Если в тексте нет ни одной рабочей задачи — верни пустой массив []
- Если написано "задача:" или "ставлю задачу" — это прямая постановка, приоритет выше (2)
- Если указан конкретный человек — он assignee (имя в именительном падеже!), иначе автор сообщения
- "Диме надо сделать X" → assignee = "Дима", а НЕ автор сообщения
- Если указан проект — запомни его в project_hint
- Дедлайн по умолчанию — сегодня, если не указано иное

Верни ТОЛЬКО JSON массив, без markdown. Если нет рабочих задач — верни []."""}],
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
    telegram_username: str | None = None,
) -> list[dict]:
    """Full pipeline: detect trigger -> parse -> create tasks -> return results."""
    from ..models.database import (
        Project, ProjectTask, ProjectMember, User, Chat, OrgMember,
    )

    if not should_trigger(message_text):
        return []

    logger.info(f"Task trigger activated for user {user_name}: {message_text[:100]}...")

    # Find user by telegram_id, then telegram_username, then name
    user = None
    if telegram_user_id:
        result = await db.execute(
            select(User).where(User.telegram_id == telegram_user_id)
        )
        user = result.scalar_one_or_none()

        # If not found by telegram_id, auto-bind for future lookups
        if not user and telegram_username:
            result = await db.execute(
                select(User).where(User.telegram_username == telegram_username)
            )
            user = result.scalar_one_or_none()
            if user and not user.telegram_id:
                user.telegram_id = telegram_user_id
                await db.flush()
                logger.info(f"Auto-bound telegram_id {telegram_user_id} to user {user.name}")

    if not user and user_name:
        result = await db.execute(
            select(User).where(User.name.ilike(f"%{user_name}%"))
        )
        user = result.scalar_one_or_none()

    # Find org — either from user or from the chat
    org_id = None
    if user:
        org_result = await db.execute(
            select(OrgMember.org_id).where(OrgMember.user_id == user.id).limit(1)
        )
        org_id = org_result.scalar_one_or_none()

    # If user not found or user has no org — try to get org from the chat
    if not org_id and chat_id:
        chat_result = await db.execute(
            select(Chat).where(Chat.telegram_chat_id == chat_id)
        )
        chat_obj = chat_result.scalar_one_or_none()
        if chat_obj and chat_obj.org_id:
            org_id = chat_obj.org_id
            # Also try to find a fallback user (chat owner) for created_by
            if not user and chat_obj.owner_id:
                owner_result = await db.execute(
                    select(User).where(User.id == chat_obj.owner_id)
                )
                user = owner_result.scalar_one_or_none()
                if user:
                    logger.info(f"Using chat owner {user.name} as fallback for unregistered sender {user_name}")

    if not user:
        logger.warning(f"User not found and no fallback: {user_name} (tg_id={telegram_user_id})")
        return []

    if not org_id:
        logger.warning(f"No organization found for user {user_name}")
        return []

    # Get ALL org projects (for project_hint matching from text)
    all_projects_result = await db.execute(
        select(Project).where(Project.org_id == org_id)
    )
    all_projects = list(all_projects_result.scalars().all())

    # Find user's projects (where they are a member)
    result = await db.execute(
        select(Project)
        .join(ProjectMember, ProjectMember.project_id == Project.id)
        .where(ProjectMember.user_id == user.id)
        .where(Project.status == 'active')
    )
    projects = list(result.scalars().all())

    # ALWAYS check if text mentions a project name — prioritize it over user's first project
    text_lower = message_text.lower()
    text_matched_project = None
    for p in all_projects:
        if p.name.lower() in text_lower:
            text_matched_project = p
            logger.info(f"Matched project '{p.name}' from message text")
            break

    # If text mentions a project, use it (even if user is not a member)
    if text_matched_project:
        if text_matched_project not in projects:
            projects.insert(0, text_matched_project)
        else:
            # Move matched to front
            projects.remove(text_matched_project)
            projects.insert(0, text_matched_project)

    if not projects:
        logger.warning(f"No active projects for user {user_name}")
        return []

    # Use first active project as default
    project = projects[0]

    # If chat is linked to a project, prefer that project
    if chat_id:
        chat_result = await db.execute(
            select(Chat).where(Chat.telegram_chat_id == chat_id)
        )
        chat = chat_result.scalar_one_or_none()
        if chat and chat.entity_id:
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

        # Resolve project from hint
        target_project = project
        project_hint = task_data.get("project_hint")
        if project_hint:
            for p in all_projects:
                if project_hint.lower() in p.name.lower():
                    target_project = p
                    break

        # Resolve assignee from hint — search by name, then by chat title
        assignee_id = user.id
        assignee_display = user_name
        assignee_hint = task_data.get("assignee_name")
        if assignee_hint:
            hint_lower = assignee_hint.lower()
            # 1. Direct search by User.name
            assignee_result = await db.execute(
                select(User).where(User.name.ilike(f"%{assignee_hint}%"))
            )
            found_user = assignee_result.scalar_one_or_none()

            # 2. If not found, search by chat title (chats named like "RND - Дима (Разработчик)")
            if not found_user:
                chat_search = await db.execute(
                    select(Chat).where(
                        Chat.is_active == True,
                        (Chat.custom_name.ilike(f"%{assignee_hint}%")) | (Chat.title.ilike(f"%{assignee_hint}%"))
                    )
                )
                matched_chat = chat_search.scalar_one_or_none()
                if matched_chat and matched_chat.entity_id:
                    # Chat is linked to an entity — find user via entity
                    from ..models.database import Entity
                    entity_result = await db.execute(
                        select(User).where(User.name.ilike(f"%{assignee_hint}%"))
                    )
                    # Try finding user by the chat's owner
                    if matched_chat.owner_id:
                        owner_result = await db.execute(
                            select(User).where(User.id == matched_chat.owner_id)
                        )
                        found_user = owner_result.scalar_one_or_none()

            # 3. If still not found, try searching org members by first name
            if not found_user:
                all_members_result = await db.execute(
                    select(User)
                    .join(OrgMember, OrgMember.user_id == User.id)
                    .where(OrgMember.org_id == org_id)
                )
                all_members = all_members_result.scalars().all()
                for m in all_members:
                    # Match first name: "Дима" in "Дмитрий Иванов" — check first name similarity
                    member_name_lower = (m.name or "").lower()
                    member_first = member_name_lower.split()[0] if member_name_lower else ""
                    if hint_lower in member_name_lower or member_name_lower in hint_lower:
                        found_user = m
                        break
                    # Common Russian diminutives
                    if hint_lower.startswith(member_first[:3]) and len(member_first) >= 3:
                        found_user = m
                        break

            if found_user:
                assignee_id = found_user.id
                assignee_display = found_user.name

        # Increment project task counter
        target_project.task_counter = (target_project.task_counter or 0) + 1

        task = ProjectTask(
            project_id=target_project.id,
            task_number=target_project.task_counter,
            title=task_data.get("title", "Без названия"),
            description=task_data.get("description"),
            status="todo",
            priority=task_data.get("priority", 1),
            estimated_hours=task_data.get("estimated_hours"),
            assignee_id=assignee_id,
            due_date=today,
            created_by=user.id,
        )
        db.add(task)

        task_key = f"{target_project.prefix}-{target_project.task_counter}" if target_project.prefix else f"#{target_project.task_counter}"
        created.append({
            "task_key": task_key,
            "title": task_data.get("title"),
            "assignee": assignee_display,
            "project": target_project.name,
        })

    if created:
        await db.commit()
        logger.info(f"Created {len(created)} tasks from chat message by {user_name}")

    return created
