"""Публичный предпросмотр кандидата для заказчика (модуль 3, 2026-07-02).

POST /entities/{id}/share-link — авторизованный рекрутёр создаёт токен-ссылку
(30 дней) на карточку кандидата.
GET /entities/public/candidate-preview/{token} — БЕЗ авторизации: заказчик
видит только ФИО/контакты/резюме/комментарии HR — никакого CRM-интерфейса.
"""
import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db
from api.models.database import (
    CandidateShareLink, Entity, EntityType, User, VacancyApplication,
)
from api.services.auth import get_current_user, get_user_org
from .common import check_entity_access

router = APIRouter()

SHARE_LINK_TTL_DAYS = 30


@router.post("/{entity_id}/share-link")
async def create_share_link(
    entity_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Создать публичную ссылку предпросмотра кандидата (живёт 30 дней)."""
    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(403, "No organization access")

    entity = (await db.execute(select(Entity).where(Entity.id == entity_id))).scalar_one_or_none()
    if not entity or entity.type != EntityType.candidate:
        raise HTTPException(404, "Candidate not found")
    if not await check_entity_access(entity, current_user, org.id, db):
        raise HTTPException(403, "Access denied to this candidate")

    link = CandidateShareLink(
        org_id=org.id,
        entity_id=entity.id,
        token=secrets.token_urlsafe(32),  # 43 симв., умещается в String(64)
        created_by=current_user.id,
        expires_at=datetime.utcnow() + timedelta(days=SHARE_LINK_TTL_DAYS),
    )
    db.add(link)
    await db.commit()
    await db.refresh(link)

    return {
        "token": link.token,
        "url_path": f"/candidate-preview/{link.token}",
        "expires_at": link.expires_at.isoformat(),
    }


@router.get("/public/candidate-preview/{token}")
async def public_candidate_preview(
    token: str,
    db: AsyncSession = Depends(get_db),
):
    """Публичные данные кандидата по токену. БЕЗ авторизации.

    404 — неизвестный токен; 410 — ссылка устарела. Отдаём строго ограниченный
    набор полей (никаких id/служебных данных CRM).
    """
    link = (await db.execute(
        select(CandidateShareLink).where(CandidateShareLink.token == token)
    )).scalar_one_or_none()
    if not link:
        raise HTTPException(404, "Ссылка недействительна")
    if link.expires_at and link.expires_at < datetime.utcnow():
        raise HTTPException(410, "Ссылка устарела")

    entity = (await db.execute(select(Entity).where(Entity.id == link.entity_id))).scalar_one_or_none()
    if not entity:
        raise HTTPException(404, "Ссылка недействительна")

    ed = dict(entity.extra_data or {})

    # Комментарии HR: extra_data.notes — только содержательные поля.
    notes = []
    for n in (ed.get("notes") or []):
        if not isinstance(n, dict):
            continue
        text = (n.get("text") or "").strip()
        if not text:
            continue
        notes.append({
            "author_name": n.get("author_name"),
            "text": text,
            "date": n.get("date"),
            "stage_label": n.get("stage_label"),
        })

    # Оценка HR: первый непустой rating из заявок кандидата (свежие сначала).
    rating = (await db.execute(
        select(VacancyApplication.rating)
        .where(
            VacancyApplication.entity_id == entity.id,
            VacancyApplication.rating.isnot(None),
        )
        .order_by(VacancyApplication.updated_at.desc())
        .limit(1)
    )).scalar_one_or_none()

    return {
        "name": entity.name,
        "position": entity.position,
        "company": entity.company,
        "phone": entity.phone,
        "email": entity.email,
        "telegram": (entity.telegram_usernames or [None])[0],
        "city": ed.get("city"),
        "salary": str(ed.get("salary")) if ed.get("salary") is not None else None,
        "resume_text": ed.get("resume_text"),
        "notes": notes,
        "rating": rating,
        "expires_at": link.expires_at.isoformat() if link.expires_at else None,
    }
