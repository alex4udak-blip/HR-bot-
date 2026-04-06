from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, or_, String
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from typing import Optional
from datetime import datetime

from ..database import get_db
from ..models.database import Entity, EntityType, EntityStatus, User, Vacancy, VacancyApplication, ApplicationStage
from ..services.auth import get_current_user, get_user_org

router = APIRouter()

class MagicButtonData(BaseModel):
    # Parsed from resume
    full_name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    telegram: Optional[str] = None
    position: Optional[str] = None
    source_url: str
    source: str  # "hh.ru", "linkedin.com", "career.habr.com"

    # Recruiter's choice
    vacancy_id: Optional[int] = None  # which funnel to add to
    comment: Optional[str] = None

class MagicButtonResponse(BaseModel):
    success: bool
    entity_id: int
    is_duplicate: bool = False
    duplicate_info: Optional[dict] = None  # who added, when, last status
    message: str

@router.post("/parse")
async def magic_button_parse(
    data: MagicButtonData,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Process a resume parsed by the Chrome extension."""
    import traceback
    import logging
    logger = logging.getLogger("hr-analyzer.magic-button")
    try:
        return await _do_magic_parse(data, db, current_user)
    except Exception as e:
        logger.error(f"Magic button error: {e}\n{traceback.format_exc()}")
        raise HTTPException(500, detail=f"Error: {str(e)}")

async def _do_magic_parse(data, db, current_user):
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(400, "User not in organization")

    # Check for duplicates by email, phone, telegram, name
    duplicate = None
    conditions = []
    if data.email:
        conditions.append(Entity.email == data.email)
    if data.phone:
        conditions.append(Entity.phone == data.phone)
    if data.telegram:
        # telegram_usernames is a JSON array, check if it contains the value
        conditions.append(Entity.telegram_usernames.cast(String).ilike(f"%{data.telegram.lower()}%"))
    # Also check by name (fuzzy)
    conditions.append(Entity.name.ilike(f"%{data.full_name}%"))

    if conditions:
        dup_result = await db.execute(
            select(Entity).where(
                Entity.org_id == org.id,
                Entity.type == EntityType.candidate,
                or_(*conditions)
            ).limit(1)
        )
        duplicate = dup_result.scalar_one_or_none()

    is_duplicate = duplicate is not None
    duplicate_info = None

    if is_duplicate:
        duplicate_info = {
            "entity_id": duplicate.id,
            "name": duplicate.name,
            "status": duplicate.status.value if duplicate.status else "unknown",
            "created_by": duplicate.created_by,
            "created_at": duplicate.created_at.isoformat() if duplicate.created_at else None,
        }

    # Create entity (even if duplicate — per TZ "can still add again")
    tg_list = [data.telegram.lower().lstrip('@')] if data.telegram else []
    entity = Entity(
        org_id=org.id,
        type=EntityType.candidate,
        name=data.full_name,
        status=EntityStatus.new,
        email=data.email,
        phone=data.phone,
        position=data.position,
        telegram_usernames=tg_list,
        extra_data={
            "source": data.source,
            "source_url": data.source_url,
            "magic_button": True,
            "comment": data.comment,
        },
        created_by=current_user.id,
    )
    db.add(entity)
    await db.flush()

    # Add to vacancy/funnel if specified
    if data.vacancy_id:
        app = VacancyApplication(
            vacancy_id=data.vacancy_id,
            entity_id=entity.id,
            stage=ApplicationStage.applied,
        )
        db.add(app)

    await db.commit()

    # --- Notification: new candidate from magic button ---
    if data.vacancy_id:
        try:
            from ..services.hr_notifications import notify_new_candidate
            vac_result = await db.execute(
                select(Vacancy).where(Vacancy.id == data.vacancy_id)
            )
            vacancy = vac_result.scalar_one_or_none()
            if vacancy:
                await notify_new_candidate(db, entity, vacancy, current_user)
        except Exception:
            import logging
            logging.getLogger("hr-analyzer.magic-button").exception(
                "notify_new_candidate failed (non-critical)"
            )

    return MagicButtonResponse(
        success=True,
        entity_id=entity.id,
        is_duplicate=is_duplicate,
        duplicate_info=duplicate_info,
        message="Кандидат добавлен" + (" (дубликат найден)" if is_duplicate else ""),
    )

@router.get("/vacancies")
async def get_my_vacancies_for_extension(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get recruiter's vacancies for the extension popup dropdown."""
    org = await get_user_org(current_user, db)
    result = await db.execute(
        select(Vacancy).where(
            Vacancy.org_id == org.id,
            Vacancy.created_by == current_user.id,
            Vacancy.status == 'open',
        ).order_by(Vacancy.title)
    )
    vacancies = result.scalars().all()
    return [{"id": v.id, "title": v.title} for v in vacancies]
