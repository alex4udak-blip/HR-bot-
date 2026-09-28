"""Вечерний отчёт сотрудника и итог дня (решение владельца 28.09.2026).

Боль владельца: отчёты приходят как попало — текстом на три минуты чтения,
файлом, голосовым или видео-демо, а картину дня приходится собирать самому.

Как работает:
1. Сотрудник шлёт отчёт в свой рабочий чат с тегом «вечерний отчёт».
   Формат любой: текст, файл, голосовое, кружок, видео — бот их уже
   расшифровывает и разбирает, сюда приходит готовый текст.
2. Модель делает выжимку: что сделано, что не доделано, проблемы, план.
3. В 18:00 по Москве бот собирает итог дня по каждому рабочему чату:
   отчёт + комментарии к задачам за день. Отчёта нет — пингует сотрудника.
"""
import json
import logging
import os
import re
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger("hr-analyzer.evening_report")

# Тег, которым сотрудник помечает отчёт. Пишут по-разному, поэтому ловим и
# «#вечерний_отчет», и «вечерний отчёт», и просто «отчёт за день».
TAG_REGEX = re.compile(
    r'#?\bвечерн\w*\s*_?\s*отч[её]т\w*'
    r'|#?\bотч[её]т\s+за\s+(?:день|сегодня)'
    r'|#отч[её]т\b',
    re.IGNORECASE,
)

# Москва: в 18:00 по ней шлём итог дня и пингуем тех, кто не отчитался.
MSK = timezone(timedelta(hours=3))
DIGEST_HOUR_MSK = 18


def has_report_tag(text: str) -> bool:
    """Сообщение помечено как вечерний отчёт."""
    return bool(text) and bool(TAG_REGEX.search(text))


def strip_tag(text: str) -> str:
    """Убрать сам тег — в выжимку он не нужен."""
    return TAG_REGEX.sub('', text or '').strip()


_SUMMARY_PROMPT = """Ты помогаешь руководителю быстро понять вечерний отчёт разработчика.

Сожми отчёт так, чтобы его можно было прочитать за 15 секунд. Ничего не
выдумывай: только то, что есть в тексте.

Ответь ТОЛЬКО JSON:
{
  "done": ["что сделано, коротко, по пунктам"],
  "in_progress": ["что в работе и не закончено"],
  "problems": ["проблемы, блокеры, риски"],
  "next": ["что планирует дальше"],
  "highlight": "одна главная мысль дня одним предложением"
}

Пустые разделы возвращай пустым списком. Пиши по-русски, по 3-8 слов на пункт.

Отчёт:
"""


async def summarize_report(text: str) -> dict:
    """Выжимка отчёта моделью. Без ключа — отдаём текст как есть."""
    clean = strip_tag(text)
    if not clean:
        return {}
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        logger.warning("ANTHROPIC_API_KEY не задан — выжимку не делаем")
        return {}
    try:
        import anthropic

        client = anthropic.AsyncAnthropic(api_key=api_key)
        response = await client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=700,
            messages=[{"role": "user", "content": _SUMMARY_PROMPT + clean[:12000]}],
        )
        raw = response.content[0].text.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        data = json.loads(raw.strip())
        return {
            "done": [str(x)[:200] for x in (data.get("done") or [])][:10],
            "in_progress": [str(x)[:200] for x in (data.get("in_progress") or [])][:10],
            "problems": [str(x)[:200] for x in (data.get("problems") or [])][:10],
            "next": [str(x)[:200] for x in (data.get("next") or [])][:10],
            "highlight": str(data.get("highlight") or "")[:300],
        }
    except Exception as e:
        logger.error(f"Выжимка отчёта не удалась: {e}")
        return {}


def format_summary(summary: dict, author: str) -> str:
    """Сообщение для чата: коротко и по разделам."""
    if not summary:
        return f"📝 <b>Вечерний отчёт</b> — {author}\n\nСохранил отчёт целиком, выжимку сделать не удалось."

    lines = [f"📝 <b>Вечерний отчёт</b> — {author}"]
    if summary.get("highlight"):
        lines.append(f"<i>{summary['highlight']}</i>")
    blocks = [
        ("✅ Сделано", summary.get("done")),
        ("🔄 В работе", summary.get("in_progress")),
        ("⚠️ Проблемы", summary.get("problems")),
        ("➡️ Дальше", summary.get("next")),
    ]
    for title, items in blocks:
        if not items:
            continue
        lines.append(f"\n<b>{title}</b>")
        lines.extend(f"  • {item}" for item in items)
    return "\n".join(lines)


async def save_report(
    db: AsyncSession,
    org_id: int,
    user_id: Optional[int],
    chat_id: Optional[int],
    author_name: str,
    source_type: str,
    text: str,
    summary: dict,
) -> "EveningReport":
    """Сохранить отчёт за сегодня. Повторный отчёт за день заменяет прежний."""
    from ..models.database import EveningReport

    today = datetime.now(MSK).date()
    existing = None
    if user_id:
        existing = (await db.execute(
            select(EveningReport).where(
                EveningReport.org_id == org_id,
                EveningReport.user_id == user_id,
                EveningReport.report_date == today,
            )
        )).scalars().first()

    if existing:
        existing.raw_text = text[:20000]
        existing.summary = summary
        existing.source_type = source_type
        existing.chat_id = chat_id
        report = existing
    else:
        report = EveningReport(
            org_id=org_id,
            user_id=user_id,
            chat_id=chat_id,
            author_name=author_name[:255],
            report_date=today,
            source_type=source_type,
            raw_text=text[:20000],
            summary=summary,
        )
        db.add(report)
    await db.commit()
    logger.info(
        f"EVENING_REPORT: {author_name} ({source_type}), чат {chat_id}, "
        f"{len(text)} символов"
    )
    return report


async def report_exists_today(db: AsyncSession, chat_id: int) -> bool:
    """Есть ли за сегодня отчёт из этого чата."""
    from ..models.database import EveningReport

    today = datetime.now(MSK).date()
    found = (await db.execute(
        select(EveningReport.id).where(
            EveningReport.chat_id == chat_id,
            EveningReport.report_date == today,
        ).limit(1)
    )).first()
    return found is not None


async def comments_of_day(db: AsyncSession, chat_id: int) -> list[dict]:
    """Комментарии за сегодня к задачам, которые родились в этом чате.

    Именно по ним видно, что человек реально делал: утром бот завёл задачи из
    плана, днём сотрудник отписывался в комментариях.
    """
    from ..models.database import Project, ProjectTask, TaskComment, User

    since = datetime.now(MSK).replace(hour=0, minute=0, second=0, microsecond=0)
    since_utc = since.astimezone(timezone.utc).replace(tzinfo=None)

    rows = (await db.execute(
        select(TaskComment.content, TaskComment.created_at, User.name,
               ProjectTask.id, ProjectTask.title, ProjectTask.task_number,
               Project.id, Project.name, Project.prefix)
        .join(ProjectTask, ProjectTask.id == TaskComment.task_id)
        .join(Project, Project.id == ProjectTask.project_id)
        .outerjoin(User, User.id == TaskComment.user_id)
        .where(
            ProjectTask.source_chat_id == chat_id,
            TaskComment.created_at >= since_utc,
        )
        .order_by(TaskComment.created_at)
    )).all()

    out = []
    for content, created_at, user_name, task_id, task_title, task_number, project_id, project_name, prefix in rows:
        out.append({
            "content": content,
            "author": user_name or "—",
            "task_id": task_id,
            "task_title": task_title,
            "task_key": f"{prefix}-{task_number}" if prefix and task_number else f"#{task_id}",
            "project_id": project_id,
            "project_name": project_name,
        })
    return out


def task_url(project_id: int, task_id: int) -> str:
    base = os.getenv("FRONTEND_URL", "https://enceladus.site")
    return f"{base}/projects/{project_id}/tasks/{task_id}"


def format_comment_ping(
    author: str, project_name: str, task_key: str, task_title: str,
    content: str, project_id: int, task_id: int,
) -> str:
    """Пинг в рабочий чат: кто, по какой задаче и что написал."""
    short = content.strip()
    if len(short) > 600:
        short = short[:600] + "…"
    return (
        f"💬 <b>{author}</b> — комментарий по задаче\n"
        f"📂 {project_name} · {task_key} «{task_title}»\n\n"
        f"{short}\n\n"
        f'🔗 <a href="{task_url(project_id, task_id)}">Открыть задачу</a>'
    )


def format_digest(
    chat_title: str, report_summary: Optional[dict], report_author: Optional[str],
    comments: list[dict],
) -> str:
    """Итог дня одним сообщением: отчёт + что писали под задачами."""
    lines = [f"🌙 <b>Итог дня</b> — {chat_title}"]

    if report_summary:
        lines.append("")
        lines.append(format_summary(report_summary, report_author or "—").replace(
            "📝 <b>Вечерний отчёт</b> — ", "📝 <b>Отчёт</b> — "
        ))
    elif report_author:
        lines.append("\n📝 Отчёт прислан, но без выжимки.")

    if comments:
        lines.append(f"\n💬 <b>Комментарии по задачам ({len(comments)})</b>")
        for c in comments:
            text = c["content"].strip().replace("\n", " ")
            if len(text) > 160:
                text = text[:160] + "…"
            lines.append(
                f'  • <a href="{task_url(c["project_id"], c["task_id"])}">{c["task_key"]}</a> '
                f'{c["task_title"]} — {text}'
            )
    else:
        lines.append("\n💬 Комментариев по задачам сегодня не было.")

    return "\n".join(lines)
