"""
Candidate Search CRM — global search and bulk actions for candidates.

Endpoints:
  GET  /api/candidates/search       — full-text search with filters, pagination, stats
  POST /api/candidates/bulk-action  — bulk status change, tag add, vacancy attach, CSV export
  GET  /api/candidates/recruiters   — list of recruiters (for filter dropdown)
  GET  /api/candidates/tags         — list of all existing tags (for autocomplete)
"""

import csv
import io
import logging
import re
from datetime import date, datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import Select, case, cast, func, literal, or_, select, String, text
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db
from api.models.database import (
    DepartmentMember,
    DeptRole,
    Entity,
    EntityStatus,
    EntityType,
    SharedAccess,
    ResourceType,
    User,
    UserRole,
    Vacancy,
    VacancyApplication,
    ApplicationStage,
    StageTransition,
    AccessLevel,
)
from api.services.auth import get_current_user, get_user_org, has_full_database_access
from api.services.shadow_filter import get_isolated_creator_ids

logger = logging.getLogger("hr-analyzer.candidate-search")

router = APIRouter()

# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class CandidateItem(BaseModel):
    id: int
    name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    telegram_username: Optional[str] = None
    status: str
    source: Optional[str] = None
    recruiter_id: Optional[int] = None
    recruiter_name: Optional[str] = None
    created_at: datetime
    tags: list = []
    position: Optional[str] = None
    company: Optional[str] = None
    vacancy_count: int = 0
    is_duplicate: bool = False
    # Из теневой базы (попадает в выдачу только при поиске) — фронт метит «Архив».
    is_archived: bool = False

    class Config:
        from_attributes = True


class StatsBlock(BaseModel):
    total: int = 0
    new: int = 0
    screening: int = 0
    practice: int = 0
    hired: int = 0
    rejected: int = 0


class CandidateSearchResponse(BaseModel):
    items: List[CandidateItem]
    total: int
    page: int
    per_page: int
    stats: StatsBlock


class BulkActionRequest(BaseModel):
    entity_ids: List[int]
    action: str  # add_to_vacancy | change_status | add_tag | export_csv
    vacancy_id: Optional[int] = None
    status: Optional[str] = None
    tag: Optional[str] = None


class RecruiterItem(BaseModel):
    id: int
    name: str

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Паттерны поиска по имени раньше строились локальным _name_search_terms — точной
# копией search_index._translit_ilike_patterns. Копия предсказуемо отстала: фикс
# «Ё≡Е» лёг в канонический хелпер, а сюда не доехал, и главные окна поиска не
# находили «Дёмина» по запросу «Демин». Теперь все окна зовут
# search_index.name_search_conditions(q) — один источник правды.


def _base_candidate_query(
    org_id: Optional[int],
    current_user: User,
    isolated_ids: list,
    include_archived: bool = False,
) -> Select:
    """Return a base SELECT for Entity filtered to candidates + org scoping.

    Скрываем frozen-копии после трансфера (is_transferred=true) — это
    read-only артефакты с суффиксом '[Transferred -> ...]' в имени,
    они не должны загромождать активную доску HR.

    include_archived — подмешать теневую базу. По умолчанию архив скрыт (пустая
    доска/списки не должны тонуть в тысячах импортных карточек), но при ПОИСКЕ
    его включаем: рекрутёр должен находить, что человек уже проходил у нас
    (карточки помечаются флагом is_archived). Права не меняются: org-скоуп и
    shadow-фильтр остаются, а сам раздел «Архив» — по-прежнему superadmin-only.
    """
    conds = [
        Entity.type == EntityType.candidate,
        Entity.is_transferred.is_not(True),
    ]
    if not include_archived:
        conds.append(Entity.is_archived.is_not(True))
    q = select(Entity).where(*conds)
    if current_user.role == UserRole.superadmin:
        if isolated_ids:
            q = q.where(~Entity.created_by.in_(isolated_ids))
    elif org_id:
        q = q.where(Entity.org_id == org_id)
    return q


def _as_str(v):
    """Привести JSON-значение к str для str-полей схемы (KanbanCard.*).

    Парсер/PDF-автозаполнение кладёт age/salary/experience в extra_data ЧИСЛОМ
    (например age=29), а KanbanCard.* типизированы Optional[str]. Pydantic v2 не
    коэрсит int→str → валидация падает → кандидат МОЛЧА выпадал с канбана
    (см. except «Skipping entity … in kanban»). Приводим заранее.
    """
    if v is None:
        return None
    return v if isinstance(v, str) else str(v)


def _age_from_birthdate(v, today: Optional[date] = None) -> Optional[str]:
    """'YYYY-MM-DD' → возраст (строка) для карточки.

    Импорт/парсер кладут в extra_data `birth_date`, но карточка показывает
    `age`. Считаем возраст на лету (не храним — иначе устаревает после дня
    рождения). Мусор/непарсимое → None.
    """
    if not v or not isinstance(v, str):
        return None
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", v.strip())
    if not m:
        return None
    try:
        bd = date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError:
        return None
    today = today or date.today()
    age = today.year - bd.year - ((today.month, today.day) < (bd.month, bd.day))
    if age < 14 or age > 100:
        return None
    return str(age)


async def _get_org_id(current_user: User, db: AsyncSession) -> Optional[int]:
    if current_user.role == UserRole.superadmin:
        return None
    org = await get_user_org(current_user, db)
    if not org:
        return None
    return org.id


# ---------------------------------------------------------------------------
# GET /search
# ---------------------------------------------------------------------------

@router.get("/search", response_model=CandidateSearchResponse)
async def search_candidates(
    q: Optional[str] = None,
    status: Optional[str] = None,
    source: Optional[str] = None,
    recruiter_id: Optional[int] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    tags: Optional[str] = None,
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    sort_by: str = Query("created_at", regex="^(name|created_at|status)$"),
    sort_order: str = Query("desc", regex="^(asc|desc)$"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    current_user = await db.merge(current_user)
    org_id = await _get_org_id(current_user, db)
    if org_id is None and current_user.role != UserRole.superadmin:
        return CandidateSearchResponse(items=[], total=0, page=page, per_page=per_page, stats=StatsBlock())

    isolated_ids = await get_isolated_creator_ids(current_user, db) if current_user.role == UserRole.superadmin else []

    # Как и на доске: архив подмешиваем только когда реально ищут.
    base = _base_candidate_query(
        org_id, current_user, isolated_ids, include_archived=bool(q and q.strip())
    )

    # --- filters ---
    if status:
        try:
            status_enum = EntityStatus(status)
            base = base.where(Entity.status == status_enum)
        except ValueError:
            pass

    if recruiter_id:
        base = base.where(Entity.created_by == recruiter_id)

    if date_from:
        base = base.where(Entity.created_at >= datetime.combine(date_from, datetime.min.time()))

    if date_to:
        base = base.where(Entity.created_at <= datetime.combine(date_to, datetime.max.time()))

    if tags:
        tag_list = [t.strip() for t in tags.split(",") if t.strip()]
        for tag in tag_list:
            base = base.where(Entity.tags.op("@>")(f'["{tag}"]'))

    if source:
        # source stored in extra_data -> source
        base = base.where(
            cast(Entity.extra_data["source"].astext, String).ilike(f"%{source}%")
        )

    # --- full-text search ---
    if q and q.strip():
        term = f"%{q.strip()}%"
        from ..services.search_index import name_search_conditions, ensure_pg_trgm_checked, contact_search_conditions
        await ensure_pg_trgm_checked(db)  # без superuser pg_trgm может отсутствовать — тогда откат на ILIKE
        base = base.where(
            or_(
                # pg_trgm (транслит + любой порядок слов + опечатки) + транслит-ILIKE + Ё≡Е
                *name_search_conditions(q),
                *contact_search_conditions(q),  # почта/телефон(норм.)/telegram + доп-списки emails[]/phones[]
                Entity.position.ilike(term),
                Entity.company.ilike(term),
                cast(Entity.tags, String).ilike(term),
                cast(Entity.extra_data, String).ilike(term),
            )
        )

    # --- stats (on the filtered base, before pagination) ---
    stats_base = base.with_only_columns(
        func.count().label("total"),
        func.count().filter(Entity.status == EntityStatus.new).label("cnt_new"),
        func.count().filter(Entity.status == EntityStatus.screening).label("cnt_screening"),
        func.count().filter(Entity.status == EntityStatus.practice).label("cnt_practice"),
        func.count().filter(Entity.status == EntityStatus.hired).label("cnt_hired"),
        func.count().filter(Entity.status == EntityStatus.rejected).label("cnt_rejected"),
    )
    stats_row = (await db.execute(stats_base)).one()
    total = stats_row.total

    stats = StatsBlock(
        total=total,
        new=stats_row.cnt_new,
        screening=stats_row.cnt_screening,
        practice=stats_row.cnt_practice,
        hired=stats_row.cnt_hired,
        rejected=stats_row.cnt_rejected,
    )

    # --- sorting ---
    sort_col = {
        "name": Entity.name,
        "created_at": Entity.created_at,
        "status": Entity.status,
    }[sort_by]

    # При поиске (q) — сначала по релевантности (лучшее совпадение первым),
    # затем по выбранной сортировке. Без q — как выбрано.
    from ..services.search_index import smart_name_score
    _score = smart_name_score(q) if (q and q.strip()) else None
    _primary = sort_col.desc() if sort_order == "desc" else sort_col.asc()
    if _score is not None:
        base = base.order_by(_score.desc(), _primary)
    else:
        base = base.order_by(_primary)

    # --- pagination ---
    offset = (page - 1) * per_page
    base = base.offset(offset).limit(per_page)

    result = await db.execute(base)
    entities = list(result.scalars().all())

    if not entities:
        return CandidateSearchResponse(items=[], total=total, page=page, per_page=per_page, stats=stats)

    entity_ids = [e.id for e in entities]
    creator_ids = list({e.created_by for e in entities if e.created_by})

    # --- fetch recruiter names ---
    recruiter_map: dict[int, str] = {}
    if creator_ids:
        users_result = await db.execute(
            select(User.id, User.name).where(User.id.in_(creator_ids))
        )
        recruiter_map = {row.id: row.name for row in users_result.all()}

    # --- vacancy counts ---
    vacancy_counts_result = await db.execute(
        select(
            VacancyApplication.entity_id,
            func.count(VacancyApplication.id).label("cnt"),
        )
        .where(VacancyApplication.entity_id.in_(entity_ids))
        .group_by(VacancyApplication.entity_id)
    )
    vacancy_count_map = {row.entity_id: row.cnt for row in vacancy_counts_result.all()}

    # --- duplicate detection (shared email or phone) ---
    duplicate_ids: set[int] = set()
    emails_list = [e.email for e in entities if e.email]
    phones_list = [e.phone for e in entities if e.phone]

    if emails_list:
        dup_email_result = await db.execute(
            select(Entity.email)
            .where(
                Entity.type == EntityType.candidate,
                Entity.email.in_(emails_list),
            )
            .group_by(Entity.email)
            .having(func.count(Entity.id) > 1)
        )
        dup_emails = {row.email for row in dup_email_result.all()}
        for e in entities:
            if e.email and e.email in dup_emails:
                duplicate_ids.add(e.id)

    if phones_list:
        dup_phone_result = await db.execute(
            select(Entity.phone)
            .where(
                Entity.type == EntityType.candidate,
                Entity.phone.in_(phones_list),
            )
            .group_by(Entity.phone)
            .having(func.count(Entity.id) > 1)
        )
        dup_phones = {row.phone for row in dup_phone_result.all()}
        for e in entities:
            if e.phone and e.phone in dup_phones:
                duplicate_ids.add(e.id)

    # --- build response items ---
    items: List[CandidateItem] = []
    for e in entities:
        tg_username = None
        if e.telegram_usernames and len(e.telegram_usernames) > 0:
            tg_username = e.telegram_usernames[0]

        source_val = None
        if e.extra_data and isinstance(e.extra_data, dict):
            source_val = e.extra_data.get("source")

        items.append(CandidateItem(
            id=e.id,
            name=e.name,
            email=e.email or (e.emails[0] if e.emails else None),
            phone=e.phone or (e.phones[0] if e.phones else None),
            telegram_username=tg_username,
            status=e.status.value if hasattr(e.status, "value") else str(e.status),
            source=source_val,
            recruiter_id=e.created_by,
            recruiter_name=recruiter_map.get(e.created_by) if e.created_by else None,
            created_at=e.created_at,
            tags=e.tags or [],
            position=e.position,
            company=e.company,
            vacancy_count=vacancy_count_map.get(e.id, 0),
            is_duplicate=e.id in duplicate_ids,
            is_archived=bool(getattr(e, "is_archived", False)),
        ))

    return CandidateSearchResponse(
        items=items,
        total=total,
        page=page,
        per_page=per_page,
        stats=stats,
    )


# ---------------------------------------------------------------------------
# POST /bulk-action
# ---------------------------------------------------------------------------

@router.post("/bulk-action")
async def bulk_action(
    body: BulkActionRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    current_user = await db.merge(current_user)
    org_id = await _get_org_id(current_user, db)

    if not body.entity_ids:
        raise HTTPException(400, "entity_ids is required")

    # Fetch entities
    q = select(Entity).where(
        Entity.id.in_(body.entity_ids),
        Entity.type == EntityType.candidate,
    )
    if org_id:
        q = q.where(Entity.org_id == org_id)

    result = await db.execute(q)
    entities = list(result.scalars().all())

    if not entities:
        raise HTTPException(404, "No matching candidates found")

    # --- add_to_vacancy ---
    if body.action == "add_to_vacancy":
        if not body.vacancy_id:
            raise HTTPException(400, "vacancy_id is required for add_to_vacancy")

        # Вакансия строго в орг вызывающего (org_id=None только у суперадмина) —
        # иначе bulk-add закидывал кандидатов в чужую воронку по vacancy_id.
        vq = select(Vacancy).where(Vacancy.id == body.vacancy_id)
        if org_id:
            vq = vq.where(Vacancy.org_id == org_id)
        vacancy_result = await db.execute(vq)
        vacancy = vacancy_result.scalar_one_or_none()
        if not vacancy:
            raise HTTPException(404, "Vacancy not found")

        # Get already-linked entity ids
        existing_result = await db.execute(
            select(VacancyApplication.entity_id).where(
                VacancyApplication.vacancy_id == body.vacancy_id,
                VacancyApplication.entity_id.in_([e.id for e in entities]),
            )
        )
        existing_ids = {row[0] for row in existing_result.all()}

        from api.services.stage_transitions import record_transition
        added = 0
        created_apps = []
        for entity in entities:
            if entity.id not in existing_ids:
                app = VacancyApplication(
                    vacancy_id=body.vacancy_id,
                    entity_id=entity.id,
                    stage=ApplicationStage.applied,
                    source="bulk_crm",
                    created_by=current_user.id,  # кто массово добавил → авто-метка HR
                )
                db.add(app)
                created_apps.append((app, entity.id))
                added += 1

        await db.commit()
        # Начальный транзишн в историю для каждого добавленного отклика.
        for app, ent_id in created_apps:
            await db.refresh(app)
            await record_transition(
                db=db,
                application_id=app.id,
                entity_id=ent_id,
                from_stage=None,
                to_stage=app.stage.value if hasattr(app.stage, "value") else str(app.stage),
                changed_by_id=current_user.id,
                comment="Первичная заявка",
            )
        if created_apps:
            await db.commit()
        return {"success": True, "action": "add_to_vacancy", "affected": added, "skipped": len(existing_ids)}

    # --- change_status ---
    elif body.action == "change_status":
        if not body.status:
            raise HTTPException(400, "status is required for change_status")
        try:
            new_status = EntityStatus(body.status)
        except ValueError:
            raise HTTPException(400, f"Invalid status: {body.status}")

        for entity in entities:
            entity.status = new_status
        await db.commit()
        return {"success": True, "action": "change_status", "affected": len(entities)}

    # --- add_tag ---
    elif body.action == "add_tag":
        if not body.tag:
            raise HTTPException(400, "tag is required for add_tag")

        tag = body.tag.strip()
        updated = 0
        for entity in entities:
            current_tags = list(entity.tags or [])
            if tag not in current_tags:
                current_tags.append(tag)
                entity.tags = current_tags
                updated += 1
        await db.commit()
        return {"success": True, "action": "add_tag", "affected": updated}

    # --- delete ---
    elif body.action == "delete":
        count = len(entities)
        for entity in entities:
            await db.delete(entity)
        await db.commit()
        return {"success": True, "action": "delete", "affected": count}

    # --- export_csv ---
    elif body.action == "export_csv":
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["ID", "Name", "Email", "Phone", "Status", "Position", "Company", "Tags", "Created At"])
        for entity in entities:
            writer.writerow([
                entity.id,
                entity.name,
                entity.email or "",
                entity.phone or "",
                entity.status.value if hasattr(entity.status, "value") else str(entity.status),
                entity.position or "",
                entity.company or "",
                ", ".join(entity.tags or []),
                entity.created_at.isoformat() if entity.created_at else "",
            ])
        output.seek(0)
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=candidates_export.csv"},
        )

    else:
        raise HTTPException(400, f"Unknown action: {body.action}")


# ---------------------------------------------------------------------------
# PATCH /{entity_id}/status  — quick status change (drag-n-drop kanban)
# ---------------------------------------------------------------------------

class ChangeStatusRequest(BaseModel):
    status: str


@router.patch("/{entity_id}/status")
async def change_candidate_status(
    entity_id: int,
    body: ChangeStatusRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Quick status change for kanban drag-n-drop."""
    current_user = await db.merge(current_user)

    try:
        new_status = EntityStatus(body.status)
    except ValueError:
        raise HTTPException(400, f"Invalid status: {body.status}")

    # Org-изоляция: смена статуса (+ синк этапов заявок) только для своего org —
    # иначе любой HR мог менять этап чужого кандидата по id.
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(403, "No organization access")
    # FOR UPDATE: сериализует конкурентную смену статуса ОДНОГО кандидата —
    # та же гонка, что чинили в update_application/bulk-move (2026-07-14): без
    # лока два почти одновременных drag-n-drop запроса оба читают старый
    # stage/status и оба пишут дубль-переход в StageTransition.
    result = await db.execute(
        select(Entity).where(
            Entity.id == entity_id,
            Entity.type == EntityType.candidate,
            Entity.org_id == org.id,
        ).with_for_update()
    )
    entity = result.scalar_one_or_none()
    if not entity:
        raise HTTPException(404, "Candidate not found")

    old_status = entity.status
    entity.status = new_status

    # Синхронизируем связанные VacancyApplication.stage. Без этого смена
    # этапа в /all-candidates меняла только Entity.status, а в воронке
    # (/my-funnels читает VacancyApplication.stage) кандидат оставался
    # в старой колонке — выглядело как «не перемещается».
    from api.models.database import STATUS_SYNC_MAP
    from api.services.stage_transitions import record_transition
    synced_apps = 0
    if new_status in STATUS_SYNC_MAP:
        target_stage = STATUS_SYNC_MAP[new_status]
        apps_result = await db.execute(
            select(VacancyApplication).where(VacancyApplication.entity_id == entity_id).with_for_update()
        )
        for app in apps_result.scalars().all():
            if app.stage != target_stage:
                old_app_stage = app.stage
                app.stage = target_stage
                app.last_stage_change_at = datetime.utcnow()
                synced_apps += 1
                # Пишем транзишн в историю — иначе смена этапа из «Все кандидаты»
                # меняла VacancyApplication.stage, но не попадала в ленту истории
                # кандидата (главный баг с импортированными кандидатами).
                await record_transition(
                    db=db,
                    application_id=app.id,
                    entity_id=entity_id,
                    from_stage=old_app_stage.value if hasattr(old_app_stage, "value") else (str(old_app_stage) if old_app_stage else None),
                    to_stage=target_stage.value if hasattr(target_stage, "value") else str(target_stage),
                    changed_by_id=current_user.id,
                )

    await db.commit()

    if synced_apps:
        logger.info(
            f"change_candidate_status: entity {entity_id} → {new_status.value}, "
            f"synced {synced_apps} VacancyApplication(s)"
        )

    return {
        "success": True,
        "entity_id": entity_id,
        "old_status": old_status.value if hasattr(old_status, "value") else str(old_status),
        "new_status": new_status.value,
    }


@router.get("/{entity_id}/stage-history")
async def get_candidate_stage_history(
    entity_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Сквозная история смены этапов кандидата по ВСЕМ его откликам.

    Используется глобальной карточкой в «Все кандидаты», чтобы показывать
    тот же лог переходов, что и карточка в воронке (единая история).
    """
    current_user = await db.merge(current_user)
    org_id = await _get_org_id(current_user, db)

    entity_result = await db.execute(
        select(Entity).where(Entity.id == entity_id, Entity.type == EntityType.candidate)
    )
    entity = entity_result.scalar_one_or_none()
    if not entity:
        raise HTTPException(404, "Candidate not found")
    if org_id and entity.org_id != org_id and current_user.role != UserRole.superadmin:
        raise HTTPException(404, "Candidate not found")

    rows = (await db.execute(
        select(StageTransition, Vacancy.title)
        .join(VacancyApplication, StageTransition.application_id == VacancyApplication.id)
        .join(Vacancy, Vacancy.id == VacancyApplication.vacancy_id)
        .where(StageTransition.entity_id == entity_id)
        .order_by(StageTransition.created_at.desc())
    )).all()

    user_ids = [t.changed_by for t, _ in rows if t.changed_by]
    names = {}
    if user_ids:
        names = {
            r[0]: r[1]
            for r in (await db.execute(
                select(User.id, User.name).where(User.id.in_(user_ids))
            )).all()
        }

    return [
        {
            "id": t.id,
            "application_id": t.application_id,
            "vacancy_title": vac_title,
            "from_stage": t.from_stage,
            "to_stage": t.to_stage,
            "changed_by": t.changed_by,
            "changed_by_name": names.get(t.changed_by),
            "comment": t.comment,
            "created_at": t.created_at.isoformat() if t.created_at else None,
        }
        for t, vac_title in rows
    ]


# ---------------------------------------------------------------------------
# GET /recruiters  — list of users who created candidates (for filter dropdown)
# ---------------------------------------------------------------------------

@router.get("/recruiters", response_model=List[RecruiterItem])
async def list_recruiters(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    current_user = await db.merge(current_user)
    org_id = await _get_org_id(current_user, db)

    q = (
        select(User.id, User.name)
        .join(Entity, Entity.created_by == User.id)
        .where(Entity.type == EntityType.candidate)
        .distinct()
    )
    if org_id:
        q = q.where(Entity.org_id == org_id)

    result = await db.execute(q)
    return [RecruiterItem(id=row.id, name=row.name) for row in result.all()]


# ---------------------------------------------------------------------------
# GET /tags  — list of all existing tags across candidates
# ---------------------------------------------------------------------------

@router.get("/tags")
async def list_tags(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    current_user = await db.merge(current_user)
    org_id = await _get_org_id(current_user, db)

    q = select(Entity.tags).where(
        Entity.type == EntityType.candidate,
        Entity.tags.isnot(None),
    )
    if org_id:
        q = q.where(Entity.org_id == org_id)

    result = await db.execute(q)
    all_tags: set[str] = set()
    for row in result.all():
        if row.tags and isinstance(row.tags, list):
            all_tags.update(row.tags)

    return sorted(all_tags)


# ---------------------------------------------------------------------------
# GET /kanban  — candidates grouped by status for kanban board
# ---------------------------------------------------------------------------

KANBAN_STATUSES = ["new", "screening", "practice", "tech_practice", "is_interview", "offer", "hired", "probation", "transferred", "rejected", "reserve"]

KANBAN_STATUS_LABELS = {
    "new": "Новый",
    "screening": "Выполняет ТЗ",
    "practice": "Интервью с HR",
    "tech_practice": "Интервью с заказчиком",
    "is_interview": "Принятие решения",
    "offer": "Выставлен оффер",
    "hired": "Оффер принят",
    "probation": "Практика",
    "transferred": "Перешёл в отдел",
    "rejected": "Отказ",
    "withdrawn": "Отозван",
    "reserve": "Резерв",
}


class KanbanCard(BaseModel):
    id: int
    name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    telegram_username: Optional[str] = None
    position: Optional[str] = None
    source: Optional[str] = None
    source_url: Optional[str] = None
    recruiter_name: Optional[str] = None
    created_at: datetime
    tags: list = []
    photo_url: Optional[str] = None
    company: Optional[str] = None
    city: Optional[str] = None
    age: Optional[str] = None
    salary: Optional[str] = None
    total_experience: Optional[str] = None
    vacancy_name: Optional[str] = None
    rejection_reason: Optional[str] = None
    # Карточка из теневой базы: попадает в выдачу ТОЛЬКО при поиске, помечается
    # на фронте плашкой «Архив», чтобы не путать с активными.
    is_archived: bool = False
    extra_data: Optional[dict] = None

    class Config:
        from_attributes = True


class KanbanColumn(BaseModel):
    status: str
    label: str
    color: Optional[str] = None  # из org stage_config (если задан)
    cards: List[KanbanCard]
    count: int


class KanbanBoardResponse(BaseModel):
    columns: List[KanbanColumn]
    total: int


@router.get("/kanban", response_model=KanbanBoardResponse)
async def get_candidates_kanban(
    q: Optional[str] = None,
    recruiter_id: Optional[int] = None,
    per_column: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get candidates grouped by EntityStatus for kanban board view."""
    current_user = await db.merge(current_user)
    org_id = await _get_org_id(current_user, db)
    isolated_ids = await get_isolated_creator_ids(current_user, db) if org_id else []

    # При ПОИСКЕ подмешиваем теневую базу: человека, который уже проходил у нас,
    # надо находить прямо здесь, а не в отдельном разделе. Без запроса архив
    # скрыт — иначе доска утонет в тысячах импортных карточек.
    base_q = _base_candidate_query(
        org_id, current_user, isolated_ids, include_archived=bool(q and q.strip())
    )

    # Optional text search
    if q and q.strip():
        search_term = f"%{q.strip().lower()}%"
        from ..services.search_index import name_search_conditions, ensure_pg_trgm_checked, contact_search_conditions
        await ensure_pg_trgm_checked(db)  # без superuser pg_trgm может отсутствовать — тогда откат на ILIKE
        base_q = base_q.where(
            or_(
                # pg_trgm (транслит + любой порядок слов + опечатки) + транслит-ILIKE + Ё≡Е
                *name_search_conditions(q),
                *contact_search_conditions(q),  # почта/телефон(норм.)/telegram + доп-списки
                Entity.position.ilike(search_term),
                Entity.company.ilike(search_term),
            )
        )

    # Recruiter filter
    if recruiter_id:
        base_q = base_q.where(Entity.created_by == recruiter_id)

    # Only fetch candidates in kanban statuses
    status_enums = []
    for s in KANBAN_STATUSES:
        try:
            status_enums.append(EntityStatus(s))
        except ValueError:
            pass
    base_q = base_q.where(Entity.status.in_(status_enums))

    # Порядок: при поиске — по релевантности (лучшее совпадение первым, ранг —
    # сумма пословных word_similarity), иначе новизна.
    from ..services.search_index import smart_name_score
    _score = smart_name_score(q) if (q and q.strip()) else None
    if _score is not None:
        base_q = base_q.order_by(_score.desc(), Entity.created_at.desc())
    else:
        base_q = base_q.order_by(Entity.created_at.desc())

    result = await db.execute(base_q)
    entities = result.scalars().all()

    # Группируем по статусу и берём только per_column на колонку ДО дорогой работы
    # (построение карточек + два IN-подзапроса фото/вакансий). Раньше всё это
    # гонялось по ВСЕМ кандидатам, а хвост выкидывался — не держало «тысячи».
    # counts считаем по полному набору, поэтому числа в колонках точные.
    by_status: dict[str, list] = {s: [] for s in KANBAN_STATUSES}
    counts: dict[str, int] = {s: 0 for s in KANBAN_STATUSES}
    for e in entities:
        status_val = e.status.value if hasattr(e.status, "value") else str(e.status)
        if status_val not in by_status:
            continue
        counts[status_val] += 1
        if len(by_status[status_val]) < per_column:
            by_status[status_val].append(e)
    # Плоский список ТОЛЬКО отображаемых кандидатов (≤ per_column × колонок)
    display_entities = [e for s in KANBAN_STATUSES for e in by_status[s]]

    # Get recruiter names
    creator_ids = {e.created_by for e in display_entities if e.created_by}
    recruiter_map = {}
    if creator_ids:
        r = await db.execute(
            select(User.id, User.name).where(User.id.in_(creator_ids))
        )
        recruiter_map = {row.id: row.name for row in r.all()}

    # Get vacancy names and rejection reasons for entities (только отображаемые)
    entity_ids = [e.id for e in display_entities]
    vacancy_map: dict = {}
    rejection_map: dict = {}

    # Bulk fetch photo files (EntityFile rows with image mime types) as a
    # fallback when extra_data.photo_url is missing. Keyed by entity_id →
    # download URL string the frontend can render directly in <img>.
    photo_file_map: dict = {}
    if entity_ids:
        try:
            from ..models.database import EntityFile, EntityFileType
            f_result = await db.execute(
                select(EntityFile.entity_id, EntityFile.id, EntityFile.file_name)
                .where(
                    EntityFile.entity_id.in_(entity_ids),
                    EntityFile.mime_type.startswith("image/"),
                    # Резюме-страницы (PDF→JPEG) хранятся как file_type=resume —
                    # это НЕ аватар, иначе скан резюме становится «фото» кандидата.
                    # Берём только настоящие фото (HH-фото = file_type other и пр.).
                    EntityFile.file_type != EntityFileType.resume,
                    # Файлы, загруженные кандидатом через АНКЕТУ, — не аватар.
                    or_(
                        EntityFile.description.is_(None),
                        ~EntityFile.description.like("Загружено через форму%"),
                    ),
                )
                .order_by(EntityFile.id.desc())
            )
            for row in f_result.all():
                # first (most recent) photo wins per entity
                if row.entity_id not in photo_file_map:
                    # Skip resume-page JPEGs (AI-generated profile pages) —
                    # those are multi-page PDF renders, not a real avatar.
                    fname = (row.file_name or "").lower()
                    # Аватар — ТОЛЬКО авто-фото: и резюме-портрет (Фото_из_резюме),
                    # и парсер-фото (Фото_<имя>) сохраняются с именем на «Фото_».
                    # Произвольные картинки, загруженные вручную через «Файл», в
                    # аватар НЕ идут (у них оригинальное имя файла).
                    if not fname.startswith("фото"):
                        continue
                    photo_file_map[row.entity_id] = (
                        f"/api/entities/{row.entity_id}/files/{row.id}/download"
                    )
        except Exception as exc:
            logger.warning(f"Photo file fallback query failed (non-critical): {exc}")

    if entity_ids:
        try:
            va_result = await db.execute(
                select(
                    VacancyApplication.entity_id,
                    Vacancy.title,
                    VacancyApplication.rejection_reason,
                ).select_from(VacancyApplication)
                .join(Vacancy, Vacancy.id == VacancyApplication.vacancy_id)
                .where(VacancyApplication.entity_id.in_(entity_ids))
            )
            for row in va_result.all():
                if row.entity_id not in vacancy_map:
                    vacancy_map[row.entity_id] = row.title
                if row.rejection_reason and row.entity_id not in rejection_map:
                    rejection_map[row.entity_id] = row.rejection_reason
        except Exception as exc:
            logger.warning(f"Vacancy map query failed (non-critical): {exc}")

    # Group by status (display_entities уже обрезаны до per_column на колонку)
    grouped: dict[str, list] = {s: [] for s in KANBAN_STATUSES}
    for e in display_entities:
        try:
            status_val = e.status.value if hasattr(e.status, "value") else str(e.status)
            if status_val not in grouped:
                continue
            tg = e.telegram_usernames[0] if e.telegram_usernames else None
            source_val = None
            ed = e.extra_data if isinstance(e.extra_data, dict) else {}
            source_url_val = None
            if ed:
                source_val = ed.get("source")
                source_url_val = ed.get("source_url")

            grouped[status_val].append(KanbanCard(
                id=e.id,
                name=e.name,
                email=e.email,
                phone=e.phone,
                telegram_username=tg,
                position=e.position,
                source=source_val,
                source_url=source_url_val,
                recruiter_name=recruiter_map.get(e.created_by),
                created_at=e.created_at,
                tags=e.tags or [],
                # Локальный URL предпочтительнее внешнего: hh.ru CDN может
                # отдавать 403 на чужой Referer / истечь срок ссылки. Локальный
                # /api/entities/.../files/.../download грузится по куке.
                photo_url=photo_file_map.get(e.id) or (ed.get("photo_url") if ed else None),
                company=getattr(e, 'company', None),
                # Импорт (ClickUp/CSV) кладёт location/birth_date, а карточка
                # показывает city/age — маппим с фолбэком, иначе шапка пустая.
                city=_as_str(ed.get("city")) or _as_str(ed.get("location")),
                age=_as_str(ed.get("age")) or _age_from_birthdate(ed.get("birth_date")),
                salary=_as_str(ed.get("salary")),
                total_experience=_as_str(ed.get("total_experience")),
                vacancy_name=vacancy_map.get(e.id),
                rejection_reason=rejection_map.get(e.id),
                is_archived=bool(getattr(e, "is_archived", False)),
                extra_data=ed if ed else None,
            ))
        except Exception as exc:
            logger.warning(f"Skipping entity {e.id} in kanban: {exc}")

    # Org-level кастомизация лейблов/цветов этапов (если админ настроил
    # через UI в /all-candidates → ⚙️). Если не настроена — дефолты.
    stage_overrides: dict[str, dict] = {}
    if org_id:
        from ..models.database import Organization
        org_res = await db.execute(select(Organization).where(Organization.id == org_id))
        org_row = org_res.scalar_one_or_none()
        cfg = (org_row.settings or {}).get("stage_config") if org_row else None
        if isinstance(cfg, list):
            for s in cfg:
                if isinstance(s, dict) and s.get("key"):
                    stage_overrides[s["key"]] = s

    columns = []
    total = 0
    for s in KANBAN_STATUSES:
        all_cards = grouped.get(s, [])
        # count — ПОЛНОЕ число в колонке (по всему набору), cards — обрезанные.
        col_count = counts.get(s, len(all_cards))
        total += col_count
        override = stage_overrides.get(s) or {}
        columns.append(KanbanColumn(
            status=s,
            label=override.get("label") or KANBAN_STATUS_LABELS.get(s, s),
            color=override.get("color"),
            cards=all_cards[:per_column],
            count=col_count,
        ))

    return KanbanBoardResponse(columns=columns, total=total)


@router.get("/ids")
async def get_candidate_ids(
    q: Optional[str] = None,
    recruiter_id: Optional[int] = None,
    status: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Полный список entity_id кандидатов по текущему фильтру доски — для «Выбрать всех».

    Доска грузит только per_column карточек на колонку, поэтому select-all на фронте
    видел лишь загруженных (бейдж «Все 115», а выбиралось 75). Этот лёгкий запрос
    отдаёт ВСЕ id того же набора (org/статусы/поиск/рекрутёр), с разумным потолком.
    """
    current_user = await db.merge(current_user)
    org_id = await _get_org_id(current_user, db)
    isolated_ids = await get_isolated_creator_ids(current_user, db) if org_id else []

    # Набор ДОЛЖЕН совпадать с доской (иначе «Выбрать всех» выделит не то):
    # там при поиске архив подмешивается — значит и здесь.
    base_q = _base_candidate_query(
        org_id, current_user, isolated_ids, include_archived=bool(q and q.strip())
    )

    if q and q.strip():
        term = f"%{q.strip().lower()}%"
        from ..services.search_index import name_search_conditions, ensure_pg_trgm_checked, contact_search_conditions
        await ensure_pg_trgm_checked(db)  # без superuser pg_trgm может отсутствовать — тогда откат на ILIKE
        base_q = base_q.where(or_(
            # pg_trgm (транслит + любой порядок слов + опечатки) + транслит-ILIKE + Ё≡Е
            *name_search_conditions(q),
            *contact_search_conditions(q),  # почта/телефон(норм.)/telegram + доп-списки
            Entity.position.ilike(term),
            Entity.company.ilike(term),
        ))
    if recruiter_id:
        base_q = base_q.where(Entity.created_by == recruiter_id)

    # Статус: конкретная вкладка (если валидна) либо все kanban-статусы.
    status_enums = []
    if status and status not in ("all", ""):
        try:
            status_enums = [EntityStatus(status)]
        except ValueError:
            status_enums = []
    if not status_enums:
        for s in KANBAN_STATUSES:
            try:
                status_enums.append(EntityStatus(s))
            except ValueError:
                pass
    base_q = base_q.where(Entity.status.in_(status_enums))

    id_q = base_q.with_only_columns(Entity.id).order_by(Entity.created_at.desc()).limit(5000)
    result = await db.execute(id_q)
    return {"ids": [row[0] for row in result.all()]}
