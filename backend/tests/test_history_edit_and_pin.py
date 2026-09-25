"""Правка комментария к переводу и закреплённая запись ленты (24.09.2026).

Разбор с рекрутёрами: в строке ленты остаётся тот, кто написал, и время
написания; «Изменено» и «кто и когда правил» показываются подсказкой — значит,
сервер обязан хранить ОБА поля (edited_at + edited_by), а не только время.
Закреп — один на воронку и общий для всех, кто её видит.
"""
from datetime import datetime, timedelta

import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.database import (
    ApplicationStage, Department, Entity, OrgMember, OrgRole, Organization,
    StageTransition, User, Vacancy, VacancyApplication, VacancyStatus,
)
from api.services.auth import create_access_token
from tests.conftest import auth_headers


def _headers(user: User) -> dict:
    return auth_headers(create_access_token(data={"sub": str(user.id)}))


@pytest_asyncio.fixture
async def application_with_comment(
    db_session: AsyncSession, organization: Organization, department: Department,
    admin_user: User, org_owner: OrgMember, candidate_entity: Entity,
):
    """Заявка с переводом, у которого есть комментарий (его и правим)."""
    now = datetime.utcnow()
    vacancy = Vacancy(
        org_id=organization.id, department_id=department.id, created_by=admin_user.id,
        title="Трафик", status=VacancyStatus.open, salary_currency="RUB",
        visible_to_all=True, created_at=now, updated_at=now,
    )
    db_session.add(vacancy)
    await db_session.commit()
    app = VacancyApplication(
        vacancy_id=vacancy.id, entity_id=candidate_entity.id,
        stage=ApplicationStage.screening, stage_order=1, created_by=admin_user.id,
        applied_at=now, last_stage_change_at=now, updated_at=now,
    )
    db_session.add(app)
    await db_session.commit()
    transition = StageTransition(
        application_id=app.id, entity_id=candidate_entity.id,
        from_stage=ApplicationStage.applied.value, to_stage=ApplicationStage.screening.value,
        changed_by=admin_user.id, comment="созвон в четверг",
        created_at=now - timedelta(hours=2),
    )
    db_session.add(transition)
    await db_session.commit()
    return app, transition


async def test_edit_comment_keeps_author_and_records_editor(
    client: AsyncClient, db_session: AsyncSession, admin_user: User,
    application_with_comment,
):
    """Правка меняет текст и пишет, КТО и КОГДА правил, не трогая автора."""
    app, transition = application_with_comment
    written_at = transition.created_at
    r = await client.patch(
        f"/api/vacancies/applications/{app.id}/history/{transition.id}",
        json={"comment": "созвон перенесли на пятницу"},
        headers=_headers(admin_user),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["comment"] == "созвон перенесли на пятницу"
    assert body["edited_by_name"] == admin_user.name

    await db_session.refresh(transition)
    assert transition.comment == "созвон перенесли на пятницу"
    assert transition.edited_by == admin_user.id
    assert transition.edited_at is not None
    # Автор и время НАПИСАНИЯ — те же: в строке ленты показывается именно он.
    assert transition.changed_by == admin_user.id
    assert transition.created_at == written_at


async def test_history_returns_edit_marks(
    client: AsyncClient, admin_user: User, application_with_comment,
):
    """Фронту нужны edited_at и имя правившего — иначе нечего показать."""
    app, transition = application_with_comment
    await client.patch(
        f"/api/vacancies/applications/{app.id}/history/{transition.id}",
        json={"comment": "правка"}, headers=_headers(admin_user),
    )
    r = await client.get(
        f"/api/vacancies/applications/{app.id}/history", headers=_headers(admin_user),
    )
    assert r.status_code == 200, r.text
    row = next(x for x in r.json() if x["id"] == transition.id)
    assert row["edited_at"] is not None
    assert row["edited_by_name"] == admin_user.name


async def test_stranger_cannot_edit_foreign_entry(
    client: AsyncClient, db_session: AsyncSession, organization: Organization,
    regular_user: User, application_with_comment,
):
    """Чужую запись правит только админ: рядовой рекрутёр получает 403."""
    app, transition = application_with_comment
    db_session.add(OrgMember(
        org_id=organization.id, user_id=regular_user.id, role=OrgRole.hr,
    ))
    await db_session.commit()

    r = await client.patch(
        f"/api/vacancies/applications/{app.id}/history/{transition.id}",
        json={"comment": "не моё, но поправлю"}, headers=_headers(regular_user),
    )
    assert r.status_code == 403, r.text
    await db_session.refresh(transition)
    assert transition.comment == "созвон в четверг"


async def test_pin_and_unpin_entry(
    client: AsyncClient, db_session: AsyncSession, admin_user: User,
    application_with_comment,
):
    """Закреп — один на воронку: новый ключ заменяет прежний, null снимает."""
    app, transition = application_with_comment

    r = await client.put(
        f"/api/vacancies/applications/{app.id}/pin",
        json={"entry_key": f"e:{transition.id}"}, headers=_headers(admin_user),
    )
    assert r.status_code == 200, r.text
    await db_session.refresh(app)
    assert app.pinned_entry_key == f"e:{transition.id}"

    r = await client.put(
        f"/api/vacancies/applications/{app.id}/pin",
        json={"entry_key": "n:abc-123"}, headers=_headers(admin_user),
    )
    assert r.status_code == 200, r.text
    await db_session.refresh(app)
    assert app.pinned_entry_key == "n:abc-123", "закреп остаётся один, прежний заменяется"

    r = await client.put(
        f"/api/vacancies/applications/{app.id}/pin",
        json={"entry_key": None}, headers=_headers(admin_user),
    )
    assert r.status_code == 200, r.text
    await db_session.refresh(app)
    assert app.pinned_entry_key is None


async def test_pin_is_visible_in_activity_feed(
    client: AsyncClient, admin_user: User, candidate_entity: Entity,
    application_with_comment,
):
    """Лента карточки отдаёт закреп и пометки правки — по ним рисуется строка."""
    app, transition = application_with_comment
    await client.put(
        f"/api/vacancies/applications/{app.id}/pin",
        json={"entry_key": f"e:{transition.id}"}, headers=_headers(admin_user),
    )
    await client.patch(
        f"/api/vacancies/applications/{app.id}/history/{transition.id}",
        json={"comment": "правка"}, headers=_headers(admin_user),
    )

    r = await client.get(
        f"/api/entities/{candidate_entity.id}/activity", headers=_headers(admin_user),
    )
    assert r.status_code == 200, r.text
    block = next(b for b in r.json() if b["application_id"] == app.id)
    assert block["pinned_entry_key"] == f"e:{transition.id}"
    event = next(e for e in block["events"] if e["id"] == transition.id)
    assert event["edited_at"] is not None
    assert event["edited_by_name"] == admin_user.name


async def test_pin_for_candidate_without_applications(
    client: AsyncClient, db_session: AsyncSession, admin_user: User,
    organization: Organization, org_owner: OrgMember, candidate_entity: Entity,
):
    """Кандидат вне воронок: закреплять всё равно нужно.

    Заявки нет, класть ключ на неё некуда — храним на самой карточке
    (владелец 24.09.2026: «а где кнопка закрепить?» у кандидата в штате).
    """
    r = await client.put(
        f"/api/entities/{candidate_entity.id}/pin",
        json={"entry_key": "n:abc-123"}, headers=_headers(admin_user),
    )
    assert r.status_code == 200, r.text
    await db_session.refresh(candidate_entity)
    assert (candidate_entity.extra_data or {}).get("pinned_entry_key") == "n:abc-123"

    r = await client.put(
        f"/api/entities/{candidate_entity.id}/pin",
        json={"entry_key": None}, headers=_headers(admin_user),
    )
    assert r.status_code == 200, r.text
    await db_session.refresh(candidate_entity)
    assert "pinned_entry_key" not in (candidate_entity.extra_data or {})
