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

def _base_candidate_query(org_id: Optional[int], current_user: User, isolated_ids: list) -> Select:
    """Return a base SELECT for Entity filtered to candidates + org scoping."""
    q = select(Entity).where(Entity.type == EntityType.candidate)
    if current_user.role == UserRole.superadmin:
        if isolated_ids:
            q = q.where(~Entity.created_by.in_(isolated_ids))
    elif org_id:
        q = q.where(Entity.org_id == org_id)
    return q


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

    base = _base_candidate_query(org_id, current_user, isolated_ids)

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
        base = base.where(
            or_(
                Entity.name.ilike(term),
                Entity.email.ilike(term),
                Entity.phone.ilike(term),
                Entity.position.ilike(term),
                Entity.company.ilike(term),
                cast(Entity.tags, String).ilike(term),
                cast(Entity.extra_data, String).ilike(term),
                # search in telegram_usernames JSON array
                cast(Entity.telegram_usernames, String).ilike(term),
                cast(Entity.emails, String).ilike(term),
                cast(Entity.phones, String).ilike(term),
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

    if sort_order == "desc":
        base = base.order_by(sort_col.desc())
    else:
        base = base.order_by(sort_col.asc())

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

        vacancy_result = await db.execute(select(Vacancy).where(Vacancy.id == body.vacancy_id))
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

        added = 0
        for entity in entities:
            if entity.id not in existing_ids:
                app = VacancyApplication(
                    vacancy_id=body.vacancy_id,
                    entity_id=entity.id,
                    stage=ApplicationStage.applied,
                    source="bulk_crm",
                )
                db.add(app)
                added += 1

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

    result = await db.execute(
        select(Entity).where(Entity.id == entity_id, Entity.type == EntityType.candidate)
    )
    entity = result.scalar_one_or_none()
    if not entity:
        raise HTTPException(404, "Candidate not found")

    old_status = entity.status
    entity.status = new_status
    await db.commit()

    return {
        "success": True,
        "entity_id": entity_id,
        "old_status": old_status.value if hasattr(old_status, "value") else str(old_status),
        "new_status": new_status.value,
    }


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

KANBAN_STATUSES = ["new", "screening", "practice", "tech_practice", "is_interview", "offer", "hired", "rejected"]

KANBAN_STATUS_LABELS = {
    "new": "Новый",
    "screening": "Скрининг",
    "practice": "Практика",
    "tech_practice": "Тех-практика",
    "is_interview": "ИС",
    "offer": "Оффер",
    "hired": "Принят",
    "rejected": "Отклонён",
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
    extra_data: Optional[dict] = None

    class Config:
        from_attributes = True


class KanbanColumn(BaseModel):
    status: str
    label: str
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

    base_q = _base_candidate_query(org_id, current_user, isolated_ids)

    # Optional text search
    if q and q.strip():
        search_term = f"%{q.strip().lower()}%"
        base_q = base_q.where(
            or_(
                Entity.name.ilike(search_term),
                Entity.email.ilike(search_term),
                Entity.phone.ilike(search_term),
                Entity.position.ilike(search_term),
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

    # Order within each column: newest first
    base_q = base_q.order_by(Entity.created_at.desc())

    result = await db.execute(base_q)
    entities = result.scalars().all()

    # Get recruiter names
    creator_ids = {e.created_by for e in entities if e.created_by}
    recruiter_map = {}
    if creator_ids:
        r = await db.execute(
            select(User.id, User.name).where(User.id.in_(creator_ids))
        )
        recruiter_map = {row.id: row.name for row in r.all()}

    # Get vacancy names and rejection reasons for entities
    entity_ids = [e.id for e in entities]
    vacancy_map: dict = {}
    rejection_map: dict = {}
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

    # Group by status
    grouped: dict[str, list] = {s: [] for s in KANBAN_STATUSES}
    for e in entities:
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
                photo_url=None,
                company=getattr(e, 'company', None),
                city=ed.get("city"),
                age=ed.get("age"),
                salary=ed.get("salary"),
                total_experience=ed.get("total_experience"),
                vacancy_name=vacancy_map.get(e.id),
                rejection_reason=rejection_map.get(e.id),
                extra_data=ed if ed else None,
            ))
        except Exception as exc:
            logger.warning(f"Skipping entity {e.id} in kanban: {exc}")

    columns = []
    total = 0
    for s in KANBAN_STATUSES:
        all_cards = grouped.get(s, [])
        total += len(all_cards)
        columns.append(KanbanColumn(
            status=s,
            label=KANBAN_STATUS_LABELS.get(s, s),
            cards=all_cards[:per_column],
            count=len(all_cards),
        ))

    return KanbanBoardResponse(columns=columns, total=total)
