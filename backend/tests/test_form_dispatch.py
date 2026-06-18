import pytest
from sqlalchemy import select

from api.models.database import (
    FormTemplate, FormDispatch, FormSubmission, Entity, EntityType, EntityStatus, Organization,
)
from api.services.auth import create_access_token


@pytest.mark.asyncio
async def test_form_dispatch_model_roundtrip(db_session, organization: Organization):
    form = FormTemplate(org_id=organization.id, title="Скрининг", slug="screening-abc123", fields=[])
    db_session.add(form)
    await db_session.flush()

    entity = Entity(org_id=organization.id, type=EntityType.candidate, name="Анна", status=EntityStatus.new)
    db_session.add(entity)
    await db_session.flush()

    dispatch = FormDispatch(form_id=form.id, entity_id=entity.id, token="tok_test_123")
    db_session.add(dispatch)
    await db_session.commit()

    row = (await db_session.execute(
        select(FormDispatch).where(FormDispatch.token == "tok_test_123")
    )).scalar_one()
    assert row.status == "sent"
    assert row.seen_by_recruiter is False
    assert row.entity_id == entity.id


def _headers(user):
    return {"Authorization": f"Bearer {create_access_token(data={'sub': str(user.id)})}"}


@pytest.mark.asyncio
async def test_create_dispatch_returns_token(client, db_session, organization, admin_user, org_owner):
    form = FormTemplate(org_id=organization.id, created_by=admin_user.id, title="Скрининг", slug="scr-1", fields=[])
    entity = Entity(org_id=organization.id, type=EntityType.candidate, name="Анна", status=EntityStatus.new)
    db_session.add_all([form, entity])
    await db_session.commit()

    resp = await client.post(f"/api/forms/{form.id}/dispatch", json={"entity_id": entity.id}, headers=_headers(admin_user))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["token"]
    assert body["url"].endswith(body["token"])
    assert body["entity_id"] == entity.id


@pytest.mark.asyncio
async def test_public_form_by_token(client, db_session, organization, admin_user):
    form = FormTemplate(org_id=organization.id, created_by=admin_user.id, title="Скрининг", slug="scr-2",
                        fields=[{"id": "f1", "type": "text", "label": "ФИО", "required": True}])
    entity = Entity(org_id=organization.id, type=EntityType.candidate, name="Анна", status=EntityStatus.new)
    db_session.add_all([form, entity])
    await db_session.flush()
    db_session.add(FormDispatch(form_id=form.id, entity_id=entity.id, token="tokpub1"))
    await db_session.commit()

    resp = await client.get("/api/forms/public/d/tokpub1")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["title"] == "Скрининг"
    assert body["fields"][0]["id"] == "f1"
    assert body["candidate_name"] == "Анна"


@pytest.mark.asyncio
async def test_token_submit_attaches_to_existing_candidate(client, db_session, organization, admin_user):
    form = FormTemplate(org_id=organization.id, created_by=admin_user.id, title="Скрининг", slug="scr-3",
                        fields=[{"id": "f1", "type": "text", "label": "ФИО", "required": True}])
    entity = Entity(org_id=organization.id, type=EntityType.candidate, name="Анна", status=EntityStatus.new)
    db_session.add_all([form, entity])
    await db_session.flush()
    entity_id = entity.id
    db_session.add(FormDispatch(form_id=form.id, entity_id=entity.id, token="toksub1", created_by=admin_user.id))
    await db_session.commit()

    before = len((await db_session.execute(select(Entity))).scalars().all())
    resp = await client.post("/api/forms/public/d/toksub1/submit", json={"data": {"f1": "Анна Иванова"}})
    assert resp.status_code == 200, resp.text

    after = len((await db_session.execute(select(Entity))).scalars().all())
    assert after == before, "новый кандидат не должен создаваться"

    sub = (await db_session.execute(select(FormSubmission))).scalar_one()
    assert sub.entity_id == entity_id
    assert sub.data["f1"] == "Анна Иванова"

    disp = (await db_session.execute(select(FormDispatch).where(FormDispatch.token == "toksub1"))).scalar_one()
    assert disp.status == "submitted"
    assert disp.seen_by_recruiter is False
    assert disp.submission_id == sub.id


@pytest.mark.asyncio
async def test_unread_count_and_mark_seen(client, db_session, organization, admin_user, org_owner):
    form = FormTemplate(org_id=organization.id, created_by=admin_user.id, title="S", slug="scr-4", fields=[])
    entity = Entity(org_id=organization.id, type=EntityType.candidate, name="Анна", status=EntityStatus.new)
    db_session.add_all([form, entity])
    await db_session.flush()
    db_session.add(FormDispatch(form_id=form.id, entity_id=entity.id, token="t-unread",
                                status="submitted", seen_by_recruiter=False, created_by=admin_user.id))
    await db_session.commit()

    r = await client.get(f"/api/forms/entity/{entity.id}/unread-count", headers=_headers(admin_user))
    assert r.status_code == 200 and r.json()["count"] == 1

    r = await client.patch(f"/api/forms/entity/{entity.id}/dispatches/seen", headers=_headers(admin_user))
    assert r.status_code == 200

    r = await client.get(f"/api/forms/entity/{entity.id}/unread-count", headers=_headers(admin_user))
    assert r.json()["count"] == 0


@pytest.mark.asyncio
async def test_submit_creates_notification(client, db_session, organization, admin_user, second_user):
    from api.models.database import Notification
    form = FormTemplate(org_id=organization.id, created_by=admin_user.id, title="S", slug="scr-5", fields=[])
    entity = Entity(org_id=organization.id, type=EntityType.candidate, name="Анна", status=EntityStatus.new)
    db_session.add_all([form, entity])
    await db_session.flush()
    db_session.add(FormDispatch(form_id=form.id, entity_id=entity.id, token="t-notif", created_by=second_user.id))
    await db_session.commit()

    await client.post("/api/forms/public/d/t-notif/submit", json={"data": {}})
    notifs = (await db_session.execute(
        select(Notification).where(Notification.user_id == second_user.id, Notification.type == "form_submitted")
    )).scalars().all()
    assert len(notifs) == 1
    assert "анкет" in notifs[0].title.lower()
