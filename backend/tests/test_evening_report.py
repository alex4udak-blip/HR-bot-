"""Вечерний отчёт, пинг по комментарию и итог дня (владелец, 28.09.2026).

Боль: отчёты приходят текстом на три минуты, файлом, голосом или видео, а
картину дня приходится собирать вручную.
"""
from datetime import datetime, timedelta

import pytest

from api.models.database import (
    Chat, ChatType, EveningReport, Project, ProjectTask, TaskComment,
)
from api.services import evening_report as ev
from api.services.auth import create_access_token


def _h(u):
    return {"Authorization": f"Bearer {create_access_token(data={'sub': str(u.id)})}"}


@pytest.mark.parametrize("text", [
    "#вечерний_отчет сегодня доделал парсер",
    "Вечерний отчёт: закрыл три задачи",
    "вечерний отчет\nсделал ревью",
    "Отчёт за день: чинил прод",
])
def test_tag_is_recognized(text):
    assert ev.has_report_tag(text)


@pytest.mark.parametrize("text", [
    "продолжаю работу",
    "отчитаюсь вечером",
    "скинь отчёт по рекламе",
])
def test_other_messages_are_not_reports(text):
    assert not ev.has_report_tag(text)


def test_tag_is_stripped_from_body():
    body = ev.strip_tag("#вечерний_отчет  Доделал парсер, завтра тесты")
    assert body == "Доделал парсер, завтра тесты"


def test_summary_is_formatted_for_reading():
    text = ev.format_summary({
        "highlight": "Парсер заработал на боевых данных",
        "done": ["Доделал парсер резюме"],
        "in_progress": ["Тесты на крайние случаи"],
        "problems": ["Падает на сканах без текста"],
        "next": ["Добавить OCR"],
    }, "Миша")
    assert "Миша" in text
    assert "Доделал парсер резюме" in text
    assert "Падает на сканах" in text
    # разделы идут блоками, а не сплошным текстом
    assert text.count("\n") >= 6


@pytest.mark.asyncio
async def test_report_is_saved_once_per_day(db_session, organization, admin_user):
    first = await ev.save_report(
        db=db_session, org_id=organization.id, user_id=admin_user.id, chat_id=-100,
        author_name="Миша", source_type="text", text="сделал А", summary={"done": ["А"]},
    )
    second = await ev.save_report(
        db=db_session, org_id=organization.id, user_id=admin_user.id, chat_id=-100,
        author_name="Миша", source_type="voice", text="сделал А и Б", summary={"done": ["А", "Б"]},
    )
    assert first.id == second.id, "повторный отчёт за день заменяет прежний, а не плодит новый"
    assert second.source_type == "voice"
    assert await ev.report_exists_today(db_session, -100) is True
    assert await ev.report_exists_today(db_session, -999) is False


@pytest.mark.asyncio
async def test_day_comments_are_collected_by_source_chat(db_session, organization, admin_user):
    """В итог дня попадают комментарии к задачам, рождённым в этом чате."""
    project = Project(
        org_id=organization.id, name="Saturn", prefix="SAT", status="active",
        created_by=admin_user.id, created_at=datetime.utcnow(),
    )
    db_session.add(project)
    await db_session.commit()
    await db_session.refresh(project)

    mine = ProjectTask(
        project_id=project.id, task_number=1, title="Поднять сервер", status="todo",
        sort_order=0, created_by=admin_user.id, created_by_bot=True, source_chat_id=-100,
        created_at=datetime.utcnow(), updated_at=datetime.utcnow(),
    )
    alien = ProjectTask(
        project_id=project.id, task_number=2, title="Чужая задача", status="todo",
        sort_order=0, created_by=admin_user.id, source_chat_id=-200,
        created_at=datetime.utcnow(), updated_at=datetime.utcnow(),
    )
    db_session.add_all([mine, alien])
    await db_session.commit()
    await db_session.refresh(mine)
    await db_session.refresh(alien)

    db_session.add_all([
        TaskComment(task_id=mine.id, user_id=admin_user.id, content="Сервер поднят, гоняю тесты",
                    created_at=datetime.utcnow()),
        TaskComment(task_id=alien.id, user_id=admin_user.id, content="Это из другого чата",
                    created_at=datetime.utcnow()),
        TaskComment(task_id=mine.id, user_id=admin_user.id, content="Вчерашний",
                    created_at=datetime.utcnow() - timedelta(days=2)),
    ])
    await db_session.commit()

    comments = await ev.comments_of_day(db_session, -100)
    assert [c["content"] for c in comments] == ["Сервер поднят, гоняю тесты"]
    assert comments[0]["task_key"] == "SAT-1"


def test_digest_mentions_report_and_comments():
    text = ev.format_digest(
        "RND — Миша",
        {"done": ["Поднял сервер"], "highlight": "Сервер в бою"},
        "Миша",
        [{"content": "Гоняю тесты", "author": "Миша", "task_id": 5, "task_title": "Поднять сервер",
          "task_key": "SAT-1", "project_id": 2, "project_name": "Saturn"}],
    )
    assert "Итог дня" in text and "RND — Миша" in text
    assert "Поднял сервер" in text
    assert "SAT-1" in text and "/projects/2/tasks/5" in text


def test_digest_says_when_nothing_happened():
    text = ev.format_digest("RND — Миша", None, None, [])
    assert "Комментариев по задачам сегодня не было" in text


def test_comment_ping_has_task_link():
    text = ev.format_comment_ping(
        "Миша", "Saturn", "SAT-1", "Поднять сервер", "Готово, проверяю", 2, 5
    )
    assert "Миша" in text and "Saturn" in text and "SAT-1" in text
    assert "/projects/2/tasks/5" in text
