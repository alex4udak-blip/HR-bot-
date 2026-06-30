"""Уведомления по заявкам: новая заявка → админам; назначение → рекрутёру."""
import pytest
from sqlalchemy import select

from api.models.database import Notification
from api.services.auth import create_access_token


def _h(u):
    return {"Authorization": f"Bearer {create_access_token(data={'sub': str(u.id)})}"}


@pytest.mark.asyncio
async def test_new_request_notifies_other_admins_not_creator(
    client, db_session, organization, admin_user, org_owner, regular_user, org_admin
):
    # admin_user (owner) создаёт заявку
    r = await client.post(
        "/api/vacancies", headers=_h(admin_user),
        json={"title": "Заявка тест", "status": "pending_review"},
    )
    assert r.status_code == 201, r.text

    notifs = (await db_session.execute(
        select(Notification).where(Notification.type == "new_request")
    )).scalars().all()
    recipients = {n.user_id for n in notifs}
    # Другой админ (regular_user) уведомлён, создатель (admin_user) — нет
    assert regular_user.id in recipients
    assert admin_user.id not in recipients


@pytest.mark.asyncio
async def test_assign_notifies_recruiter(
    client, db_session, organization, admin_user, org_owner, second_user, org_member
):
    r = await client.post(
        "/api/vacancies", headers=_h(admin_user),
        json={"title": "Заявка для назначения", "status": "pending_review"},
    )
    assert r.status_code == 201, r.text
    vid = r.json()["id"]

    r2 = await client.post(
        f"/api/vacancies/{vid}/assign", headers=_h(admin_user),
        json={"user_ids": [second_user.id], "all": False},
    )
    assert r2.status_code == 200, r2.text

    notifs = (await db_session.execute(
        select(Notification).where(
            Notification.type == "request_assigned",
            Notification.user_id == second_user.id,
        )
    )).scalars().all()
    assert len(notifs) >= 1
