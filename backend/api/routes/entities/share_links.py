"""Публичный предпросмотр кандидата для заказчика (модуль 3, 2026-07-02).

POST /entities/{id}/share-link — авторизованный рекрутёр создаёт токен-ссылку
(30 дней) на карточку кандидата.
GET /entities/public/candidate-preview/{token} — БЕЗ авторизации: заказчик
видит только ФИО/контакты/резюме/комментарии HR — никакого CRM-интерфейса.
"""
import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db
from api.models.database import (
    CandidateShareLink, Entity, EntityFile, EntityType, StageTransition,
    User, Vacancy, VacancyApplication,
)
from api.services.auth import get_current_user, get_user_org
from .common import check_entity_access

router = APIRouter()

SHARE_LINK_TTL_DAYS = 30

# Единый RU-словарь этапов (согласован с analytics/funnel.py и фронтом).
STAGE_LABELS = {
    "applied": "Новый",
    "screening": "Выполняет ТЗ",
    "phone_screen": "Интервью с HR",
    "interview": "Интервью с заказчиком",
    "assessment": "Принятие решения",
    "offer": "Выставлен оффер",
    "hired": "Оффер принят",
    "probation": "Практика",
    "transferred": "Перешёл в отдел",
    "rejected": "Отказ",
    "withdrawn": "Отозван",
}


def _stage_label(stage_value: str, vacancy: Vacancy | None) -> str:
    """Лейбл этапа: кастомные колонки воронки → дефолтный словарь → сырой ключ."""
    if vacancy is not None and isinstance(vacancy.custom_stages, dict):
        for col in vacancy.custom_stages.get("columns") or []:
            if isinstance(col, dict) and (
                col.get("key") == stage_value or col.get("maps_to") == stage_value
            ):
                label = col.get("label")
                if label:
                    return str(label)
    return STAGE_LABELS.get(stage_value, stage_value)


async def _resolve_valid_link(db: AsyncSession, token: str) -> CandidateShareLink:
    link = (await db.execute(
        select(CandidateShareLink).where(CandidateShareLink.token == token)
    )).scalar_one_or_none()
    if not link:
        raise HTTPException(404, "Ссылка недействительна")
    if link.expires_at and link.expires_at < datetime.utcnow():
        raise HTTPException(410, "Ссылка устарела")
    return link


async def _find_photo_file(db: AsyncSession, entity_id: int) -> EntityFile | None:
    """Авто-фото кандидата — та же логика, что аватар карточки
    (_load_photo_file_map): image/*, не из анкеты, имя на «Фото».
    """
    rows = (await db.execute(
        select(EntityFile)
        .where(
            EntityFile.entity_id == entity_id,
            EntityFile.mime_type.startswith("image/"),
            or_(
                EntityFile.description.is_(None),
                ~EntityFile.description.like("Загружено через форму%"),
            ),
        )
        .order_by(EntityFile.id.desc())
    )).scalars().all()
    for f in rows:
        if (f.file_name or "").lower().startswith("фото"):
            return f
    return None


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
    """Публичные данные кандидата по токену — реплика КАРТОЧКИ кандидата
    (read-only, без кликабельных элементов). БЕЗ авторизации.

    404 — неизвестный токен; 410 — ссылка устарела.
    """
    link = await _resolve_valid_link(db, token)

    entity = (await db.execute(select(Entity).where(Entity.id == link.entity_id))).scalar_one_or_none()
    if not entity:
        raise HTTPException(404, "Ссылка недействительна")

    ed = dict(entity.extra_data or {})

    # Текущий этап: свежая заявка кандидата + её вакансия (лейбл через кастомные
    # колонки воронки, если заданы).
    app_row = (await db.execute(
        select(VacancyApplication)
        .where(VacancyApplication.entity_id == entity.id)
        .order_by(VacancyApplication.applied_at.desc())
        .limit(1)
    )).scalar_one_or_none()
    vacancy = None
    if app_row is not None:
        vacancy = (await db.execute(
            select(Vacancy).where(Vacancy.id == app_row.vacancy_id)
        )).scalar_one_or_none()
    stage_value = str(app_row.stage.value) if app_row is not None else None

    # Таймлайн как в карточке: комментарии (notes) + история переходов этапов.
    timeline = []
    for n in (ed.get("notes") or []):
        if not isinstance(n, dict):
            continue
        text = (n.get("text") or "").strip()
        if not text:
            continue
        timeline.append({
            "author_name": n.get("author_name"),
            "date": n.get("date"),
            "title": f"Этап: {n['stage_label']}" if n.get("stage_label") else None,
            "text": text,
        })
    if app_row is not None:
        transitions = (await db.execute(
            select(StageTransition)
            .where(StageTransition.application_id == app_row.id)
            .order_by(StageTransition.created_at.desc())
            .limit(30)
        )).scalars().all()
        for t in transitions:
            frm = _stage_label(str(t.from_stage), vacancy) if t.from_stage else None
            to = _stage_label(str(t.to_stage), vacancy)
            timeline.append({
                "author_name": None,
                "date": t.created_at.isoformat() if t.created_at else None,
                "title": f"{frm} → {to}" if frm else f"Этап: {to}",
                "text": (t.comment or "").strip() or None,
            })
    timeline.sort(key=lambda x: x.get("date") or "", reverse=True)

    # Файлы — ТОЛЬКО названия (некликабельно, это просто предпросмотр).
    file_names = [
        row[0] for row in (await db.execute(
            select(EntityFile.file_name)
            .where(EntityFile.entity_id == entity.id)
            .order_by(EntityFile.id.desc())
        )).all()
        if row[0] and not (row[0] or "").lower().startswith("фото")
    ]

    # Фото: локальный файл (через публичный photo-эндпоинт) → extra_data.photo_url.
    photo_url = None
    if await _find_photo_file(db, entity.id) is not None:
        photo_url = f"/api/entities/public/candidate-preview/{link.token}/photo"
    elif isinstance(ed.get("photo_url"), str):
        photo_url = ed.get("photo_url")

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
        "age": str(ed.get("age")) if ed.get("age") is not None else None,
        "total_experience": str(ed.get("total_experience")) if ed.get("total_experience") is not None else None,
        "source": ed.get("source"),
        "salary": str(ed.get("salary")) if ed.get("salary") is not None else None,
        "photo_url": photo_url,
        "stage": stage_value,
        "stage_label": _stage_label(stage_value, vacancy) if stage_value else None,
        "vacancy_title": vacancy.title if vacancy is not None else None,
        "timeline": timeline,
        "files": file_names,
        "rating": rating,
        "expires_at": link.expires_at.isoformat() if link.expires_at else None,
    }


@router.get("/public/candidate-preview/{token}/photo")
async def public_candidate_photo(
    token: str,
    db: AsyncSession = Depends(get_db),
):
    """Фото кандидата для публичного предпросмотра (по тому же токену)."""
    link = await _resolve_valid_link(db, token)
    photo = await _find_photo_file(db, link.entity_id)
    if photo is None or not photo.file_data:
        raise HTTPException(404, "Фото не найдено")
    return Response(content=photo.file_data, media_type=photo.mime_type or "image/jpeg")
