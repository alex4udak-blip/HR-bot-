"""
Auto-creates project tasks from Telegram chat messages.
Triggers on planning-related keywords and uses Claude AI to parse.
Also detects status reports and updates project progress.
"""
import re
import os
import logging
import json
from typing import Optional
from datetime import datetime
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger("hr-analyzer.task_trigger")

# Trigger words (Russian)
# ── Модальные слова (intent) ──────────────────────────────────────
_MODALS = [
    r'надо', r'нужно', r'необходимо', r'требуется', r'следует',
    r'нужн[аоы]',                          # нужна/нужно/нужны
    r'должн?[аеоы]?',                      # должен/должна/должно/должны
    r'обязан[аоы]?',                        # обязан/обязана
    r'стоит',                               # "стоит проверить"
    r'пора',                                # "пора делать"
    r'важно',                               # "важно сделать"
    r'хочу', r'хочет', r'хотим',
    r'буду', r'будет', r'будем', r'будут',
    r'планиру[юет]',                        # планирую/планирует
    r'собираюсь', r'собирается',
    r'предлагаю',
    r'попрошу', r'прошу', r'просьба',
    r'поручаю', r'поручи',
    r'давай', r'давайте',  # + "давайте добавим" через самостоятельные глаголы ниже
    r'начн[уиёе]',                          # начну/начни/начнём/начнёт
]

# ── Глаголы действия ─────────────────────────────────────────────
_ACTIONS = [
    r'сделать', r'делать', r'доделать',
    r'провести', r'проводить',
    r'проверить', r'проверять',
    r'написать', r'писать', r'дописать', r'переписать',
    r'настроить', r'настраивать', r'перенастроить',
    r'подготовить', r'готовить',
    r'исправить', r'исправлять', r'починить', r'пофиксить', r'фиксить',
    r'обновить', r'обновлять',
    r'добавить', r'добавлять',
    r'удалить', r'убрать',
    r'создать', r'создавать',
    r'реализовать', r'имплементировать', r'заимплементить',
    r'протестировать', r'тестировать', r'потестить',
    r'задеплоить', r'деплоить', r'выкатить', r'выкатывать',
    r'отрефакторить', r'рефакторить', r'рефакторинг',
    r'оптимизировать',
    r'интегрировать',
    r'мигрировать', r'мигрировать',
    r'разработать', r'разрабатывать',
    r'запустить', r'запускать',
    r'завершить', r'закончить',
    r'ревьюить', r'отревьюить',
    r'замержить', r'мержить',
    r'закоммитить', r'коммитить', r'запушить',
    r'поднять', r'развернуть',
    r'перевести', r'переводить',             # "перевести на новый API"
    r'переделать', r'переработать',
    r'внедрить', r'внедрять',
    r'подключить', r'подключать',
    r'документировать', r'задокументировать',
    r'согласовать',
    r'спроектировать', r'проектировать',
    r'автоматизировать',
    r'продвинуть(?:ся)?', r'продвинутся',  # "продвинуться в генерации"
    r'выпустить', r'выпускать',             # "выпустить в пользование"
    r'улучшить', r'улучшать', r'улучшить',
    r'развить', r'развивать',
    r'закрыть',                              # "закрыть таску"
    r'доработать', r'дорабатывать',
]

# Комбинаторные паттерны: модальное_слово .* действие
_MODAL_ACTION_PATTERNS = [
    rf'{modal}.*{action}'
    for modal in _MODALS
    for action in _ACTIONS
]

TRIGGER_PATTERNS = [
    # ── Прямая постановка задачи ──────────────────────────────────
    r'задач[уаие]',                         # задача, задачу, задачи, задаче
    r'ставлю задач', r'поставь задач',
    r'создай задач', r'создать задач',
    r'новая задач', r'новый таск',
    r'таск[:\s]', r'тикет[:\s]',
    r'todo[:\s]',

    # ── Самостоятельные глаголы (1-е лицо, без модального) ─────────
    r'сделаю',  r'доделаю', r'переделаю',
    r'займусь', r'возьмусь',
    r'пофикш', r'починю', r'исправлю',
    r'напишу', r'допишу', r'перепишу',
    r'проверю', r'протестирую', r'потестирую',
    r'настрою', r'перенастрою',
    r'обновлю', r'добавлю', r'уберу', r'удалю',
    r'создам', r'реализую',
    r'задеплою', r'выкачу',
    r'отрефакторю',
    r'оптимизирую',
    r'интегрирую',
    r'запущу', r'подниму', r'разверну',
    r'подготовлю',
    r'закончу', r'завершу', r'доработаю',
    r'замержу', r'запушу', r'закоммичу',
    r'отревьюю',
    r'подключу',
    r'внедрю',
    r'спроектирую',
    r'продвинусь', r'продвинемся',
    r'улучшу', r'улучшим',
    r'выпущу', r'выпустим',
    r'закрою', r'закроем',
    r'доработаю', r'доработаем',
    # Формы "мы" (1-е лицо мн.ч.)
    r'добавим', r'сделаем', r'проверим', r'напишем', r'создадим',
    r'настроим', r'обновим', r'исправим', r'запустим', r'завершим',
    r'подготовим', r'протестируем', r'задеплоим', r'отрефакторим',
    r'интегрируем', r'оптимизируем', r'внедрим', r'переделаем',

    # ── Планирование ──────────────────────────────────────────────
    r'план на', r'в планах', r'планы на',
    r'начну делать', r'начну работать',
    r'начинаю работать', r'начинаю делать',
    r'приступаю', r'приступлю',
    r'сегодня:', r'сегодня буду', r'сегодня планирую',
    r'сегодня надо', r'сегодня нужно',
    r'сегодня в планах', r'сегодня хочу',
    r'продолжаю работу', r'продолжаю работать',
    r'продолжаю развивать', r'продолжаю делать',
    r'с утра', r'утром буду',
    r'утренний план',
    r'доброе утро.*план', r'доброе утро.*работ',
    r'good morning', r'гуд морнинг',

    # ── Нумерованные/маркированные списки (стендап-паттерн) ─────────
    r'1[\.\)]\s*.+\n\s*2[\.\)]',               # "1. ... \n 2. ..." — numbered list
    r'[-•]\s*.+\n\s*[-•]\s',                    # "- ...\n- ..." — bullet list

    # ── План на день ─────────────────────────────────────────────────
    r'план на день',                            # "План на день для FB Analitic"
    r'план работ',
    r'тестирование\s', r'исправление\s',       # noun forms of actions
    r'разработка\s', r'настройка\s', r'интеграция\s',
    r'рефакторинг\s', r'оптимизация\s',

    # ── Английские триггеры ───────────────────────────────────────
    r'i will', r"i'll",
    r'need to', r'have to', r'got to', r'gotta',
    r'going to', r'gonna',
    r'should', r'must',
    r'let me', r"let's",
    r'working on', r'work on',
    r'implement', r'deploy', r'fix', r'refactor',

    # ── Комбинаторные: модальное + действие ───────────────────────
    *_MODAL_ACTION_PATTERNS,
]

TRIGGER_REGEX = re.compile('|'.join(TRIGGER_PATTERNS), re.IGNORECASE)


def should_trigger(text: str) -> bool:
    """Check if message contains trigger words (fast regex pre-filter)."""
    return bool(TRIGGER_REGEX.search(text))


async def should_trigger_ai(text: str) -> bool:
    """Use Claude Haiku to determine if a message contains tasks/plans.

    Falls back to regex if AI is unavailable.
    """
    if len(text.strip()) < 10:
        return False

    # Fast regex check first — if it matches, no need for AI
    if should_trigger(text):
        logger.info(f"🔍 Regex trigger matched, skipping AI check")
        return True

    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        return False

    try:
        import anthropic
        client = anthropic.Anthropic(api_key=api_key)

        response = client.messages.create(
            model="claude-haiku-4-20250414",
            max_tokens=10,
            messages=[{"role": "user", "content": f"""Это сообщение из рабочего чата. Содержит ли оно план работ, задачи на день, или постановку задач кому-то?

Сообщение:
{text}

Ответь ТОЛЬКО одним словом: ДА или НЕТ"""}],
        )

        answer = response.content[0].text.strip().upper()
        result = answer.startswith("ДА") or answer == "YES"
        logger.info(f"🤖 AI trigger check: '{answer}' -> {result} for: {text[:60]}...")
        return result
    except Exception as e:
        logger.error(f"AI trigger check failed: {e}")
        # Fallback to regex
        return False


def _extract_project_hint(text: str) -> Optional[str]:
    """Try to extract a project name from the message.

    Heuristics:
    - First line if it's short (< 40 chars) and not a sentence (likely a project title)
    - Text after "на проекте", "проект:", "для" etc.
    """
    lines = [l.strip() for l in text.strip().split('\n') if l.strip()]
    if not lines:
        return None

    # Check first line — if short and not a numbered item, treat as project name
    first = lines[0]
    if len(first) < 50 and not re.match(r'^\d+[\.\)]', first) and not re.search(r'(план|сегодня|доброе|привет)', first, re.IGNORECASE):
        # If first line is short and second line looks like a list, first line is project name
        if len(lines) > 1 and re.match(r'^(\d+[\.\)]|[-•])', lines[1]):
            return first

    # Look for "на проекте X", "проект: X", "для X -", "План на день для X"
    patterns = [
        r'(?:на проекте|по проекту|проект[:\s])\s*[«"]?([A-Za-zА-Яа-яёЁ0-9_ -]+)',
        r'для\s+([A-Za-zА-Яа-яёЁ0-9_ ]+?)(?:\s*[-–—:]|\s+тестирование|\s+разработка|\s+исправление)',
    ]
    for pat in patterns:
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            name = m.group(1).strip()
            if len(name) > 2 and len(name) < 60:
                return name

    return None


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
    telegram_user_id: Optional[int],
    chat_id: Optional[int] = None,
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
    telegram_user_id: Optional[int],
    chat_id: Optional[int],
    telegram_username: Optional[str] = None,
) -> list[dict]:
    """Full pipeline: detect trigger -> parse -> create tasks -> return results."""
    from ..models.database import (
        Project, ProjectTask, ProjectMember, ProjectStatus, ProjectRole, User, Chat, OrgMember,
    )

    is_task = await should_trigger_ai(message_text)
    if not is_task:
        logger.info(f"⏭️ No trigger (regex+AI) for {user_name}: {message_text[:80]}...")
        return []

    logger.info(f"✅ Task trigger activated for {user_name}: {message_text[:100]}...")

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
                select(User).where(func.lower(User.telegram_username) == telegram_username.lower())
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

    # If user still not found, try to find ANY user in the org as creator fallback
    if not user and org_id:
        from ..models.database import Organization
        # Use the first superadmin or admin as fallback creator
        fallback_result = await db.execute(
            select(User)
            .join(OrgMember, OrgMember.user_id == User.id)
            .where(OrgMember.org_id == org_id)
            .where(User.role.in_(["superadmin", "admin"]))
            .limit(1)
        )
        user = fallback_result.scalar_one_or_none()
        if user:
            logger.info(f"Using org admin {user.name} as fallback creator for unregistered sender {user_name}")

    if not user:
        logger.warning(f"❌ User not found and no fallback: {user_name} (tg_id={telegram_user_id}, tg_username={telegram_username})")
        return []

    logger.info(f"👤 User resolved: {user.name} (id={user.id}) for sender {user_name}")

    if not org_id:
        logger.warning(f"❌ No organization found for user {user_name}")
        return []

    logger.info(f"🏢 Org resolved: org_id={org_id}")

    # Get ALL org projects (for project_hint matching from text)
    all_projects_result = await db.execute(
        select(Project).where(Project.org_id == org_id)
    )
    all_projects = list(all_projects_result.scalars().all())
    logger.info(f"📂 Found {len(all_projects)} org projects: {[p.name for p in all_projects[:5]]}")

    # Find user's projects (where they are a member)
    result = await db.execute(
        select(Project)
        .join(ProjectMember, ProjectMember.project_id == Project.id)
        .where(ProjectMember.user_id == user.id)
        .where(Project.status == 'active')
    )
    projects = list(result.scalars().all())
    logger.info(f"👤 User {user.name} has {len(projects)} active projects: {[p.name for p in projects[:5]]}")

    # ALWAYS check if text mentions a project name — prioritize it over user's first project
    text_lower = message_text.lower()
    text_matched_project = None
    for p in all_projects:
        if p.name.lower() in text_lower:
            text_matched_project = p
            logger.info(f"🎯 Matched project '{p.name}' from message text")
            break

    # If text mentions a project, use it (even if user is not a member)
    if text_matched_project:
        if text_matched_project not in projects:
            projects.insert(0, text_matched_project)
        else:
            # Move matched to front
            projects.remove(text_matched_project)
            projects.insert(0, text_matched_project)

    # If no project found but text mentions a project-like name, try to extract and auto-create
    if not projects:
        # Try to extract project name from the message (first line or word before numbered list)
        project_hint = _extract_project_hint(message_text)
        if project_hint:
            logger.info(f"🔨 Auto-creating project '{project_hint}' for org {org_id}")
            new_project = Project(
                org_id=org_id,
                name=project_hint,
                status=ProjectStatus.active,
                created_by=user.id,
            )
            db.add(new_project)
            await db.flush()
            # Add user as member
            db.add(ProjectMember(
                project_id=new_project.id,
                user_id=user.id,
                role=ProjectRole.developer,
            ))
            await db.flush()
            projects = [new_project]
            logger.info(f"✅ Created project '{project_hint}' (id={new_project.id})")

    if not projects:
        logger.warning(f"❌ No active projects for user {user_name} and could not auto-create")
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
