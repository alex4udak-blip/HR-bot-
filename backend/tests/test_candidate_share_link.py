"""Публичный предпросмотр кандидата (share-link, модуль 3)."""
from datetime import datetime, timedelta

import pytest
from sqlalchemy import select

from api.models.database import (
    CandidateShareLink, Entity, EntityType, EntityStatus,
)
from api.services.auth import create_access_token


def _h(u):
    return {"Authorization": f"Bearer {create_access_token(data={'sub': str(u.id)})}"}


async def _mk_candidate(db, org, user) -> Entity:
    e = Entity(
        org_id=org.id, created_by=user.id, name="Пётр Кандидатов",
        type=EntityType.candidate, status=EntityStatus.new,
        phone="+79990001122", email="petr@example.com",
        position="QA engineer", company="ООО Тест",
        extra_data={
            "resume_text": "Опыт 5 лет, автотесты",
            "city": "Казань",
            "notes": [
                {"id": "n1", "text": "Хороший кандидат", "author_name": "Мария", "date": "2026-07-01"},
                {"id": "n2", "text": "", "author_name": "Мария"},  # пустой — не отдаём
            ],
        },
        created_at=datetime.utcnow(),
    )
    db.add(e)
    await db.commit()
    await db.refresh(e)
    return e


@pytest.mark.asyncio
async def test_create_and_read_share_link(
    client, db_session, organization, admin_user, org_owner
):
    cand = await _mk_candidate(db_session, organization, admin_user)
    r = await client.post(f"/api/entities/{cand.id}/share-link", headers=_h(admin_user))
    assert r.status_code == 200, r.text
    token = r.json()["token"]
    assert r.json()["url_path"] == f"/candidate-preview/{token}"

    # Публичное чтение — БЕЗ заголовков авторизации
    pub = await client.get(f"/api/entities/public/candidate-preview/{token}")
    assert pub.status_code == 200, pub.text
    body = pub.json()
    assert body["name"] == "Пётр Кандидатов"
    assert body["phone"] == "+79990001122"
    assert body["resume_text"] == "Опыт 5 лет, автотесты"
    # Пустой комментарий отфильтрован
    assert [n["text"] for n in body["notes"]] == ["Хороший кандидат"]


@pytest.mark.asyncio
async def test_unknown_token_404(client):
    r = await client.get("/api/entities/public/candidate-preview/nope-token")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_expired_token_410(
    client, db_session, organization, admin_user, org_owner
):
    cand = await _mk_candidate(db_session, organization, admin_user)
    r = await client.post(f"/api/entities/{cand.id}/share-link", headers=_h(admin_user))
    token = r.json()["token"]
    # Протухляем ссылку напрямую в БД
    link = (await db_session.execute(
        select(CandidateShareLink).where(CandidateShareLink.token == token)
    )).scalar_one()
    link.expires_at = datetime.utcnow() - timedelta(days=1)
    await db_session.commit()

    pub = await client.get(f"/api/entities/public/candidate-preview/{token}")
    assert pub.status_code == 410
