import asyncio
import logging
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy import select, or_, String
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from typing import Optional
from datetime import datetime

from ..database import get_db
from ..models.database import (
    Entity, EntityType, EntityStatus, EntityFile, EntityFileType,
    User, Vacancy, VacancyApplication, ApplicationStage,
)
from ..services.auth import get_current_user, get_user_org

logger = logging.getLogger("hr-analyzer.magic-button")

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

    # Extra parsed fields
    city: Optional[str] = None
    age: Optional[str] = None
    birthday: Optional[str] = None
    gender: Optional[str] = None
    salary: Optional[str] = None
    experience_summary: Optional[str] = None
    total_experience: Optional[str] = None
    experience_descriptions: Optional[list] = None
    skills: Optional[list] = None
    languages: Optional[list] = None

    # Recruiter's choice
    vacancy_id: Optional[int] = None  # which funnel to add to
    comment: Optional[str] = None

class MagicButtonResponse(BaseModel):
    success: bool
    entity_id: int
    is_duplicate: bool = False
    duplicate_info: Optional[dict] = None  # who added, when, last status
    message: str

class DuplicateCheckRequest(BaseModel):
    full_name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    telegram: Optional[str] = None

class DuplicateCheckResponse(BaseModel):
    is_duplicate: bool
    duplicates: list = []  # [{entity_id, name, email, phone, status, created_at}]

@router.post("/check-duplicate")
async def check_duplicate(
    data: DuplicateCheckRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Check for duplicates before adding a candidate."""
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(400, "User not in organization")

    conditions = []
    if data.email:
        conditions.append(Entity.email == data.email)
    if data.phone:
        conditions.append(Entity.phone == data.phone)
    if data.telegram:
        conditions.append(Entity.telegram_usernames.cast(String).ilike(f"%{data.telegram.lower()}%"))
    # Name match
    name_parts = data.full_name.strip().split()
    if len(name_parts) >= 2:
        # Match by last name + first name (ignore middle name typos)
        conditions.append(Entity.name.ilike(f"%{name_parts[0]}%{name_parts[1]}%"))
    else:
        conditions.append(Entity.name.ilike(f"%{data.full_name}%"))

    if not conditions:
        return DuplicateCheckResponse(is_duplicate=False, duplicates=[])

    dup_result = await db.execute(
        select(Entity).where(
            Entity.org_id == org.id,
            Entity.type == EntityType.candidate,
            or_(*conditions)
        ).limit(5)
    )
    duplicates = dup_result.scalars().all()

    return DuplicateCheckResponse(
        is_duplicate=len(duplicates) > 0,
        duplicates=[
            {
                "entity_id": d.id,
                "name": d.name,
                "email": d.email,
                "phone": d.phone,
                "status": d.status.value if d.status else "unknown",
                "created_at": d.created_at.isoformat() if d.created_at else None,
            }
            for d in duplicates
        ],
    )

@router.post("/parse")
async def magic_button_parse(
    data: MagicButtonData,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Process a resume parsed by the Chrome extension."""
    import traceback
    try:
        return await _do_magic_parse(data, db, current_user, background_tasks)
    except Exception as e:
        logger.error(f"Magic button error: {e}\n{traceback.format_exc()}")
        raise HTTPException(500, detail=f"Error: {str(e)}")

async def _do_magic_parse(data, db, current_user, background_tasks: BackgroundTasks):
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

    # Build extra_data with all parsed fields
    extra = {
        "source": data.source,
        "source_url": data.source_url,
        "magic_button": True,
        "comment": data.comment,
    }
    if data.city:
        extra["city"] = data.city
    if data.age:
        extra["age"] = data.age
    if data.birthday:
        extra["birth_date"] = data.birthday
    if data.gender:
        extra["gender"] = data.gender
    if data.salary:
        extra["salary"] = data.salary
    if data.experience_summary:
        extra["experience_summary"] = data.experience_summary
    if data.total_experience:
        extra["total_experience"] = data.total_experience
    if data.experience_descriptions:
        extra["experience_descriptions"] = data.experience_descriptions
    if data.skills:
        extra["skills"] = data.skills
    if data.languages:
        extra["languages"] = data.languages

    entity = Entity(
        org_id=org.id,
        type=EntityType.candidate,
        name=data.full_name,
        status=EntityStatus.new,
        email=data.email,
        phone=data.phone,
        position=data.position,
        telegram_usernames=tg_list,
        extra_data=extra,
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
            source=data.source,
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

    # --- Generate AI resume PDF + JPEG in background ---
    entity_id = entity.id
    org_id = org.id
    user_id = current_user.id
    candidate_data = {
        "full_name": data.full_name,
        "position": data.position,
        "email": data.email,
        "phone": data.phone,
        "telegram": data.telegram,
        "city": data.city,
        "age": data.age,
        "birthday": data.birthday,
        "gender": data.gender,
        "salary": data.salary,
        "total_experience": data.total_experience,
        "experience_summary": data.experience_summary,
        "experience_descriptions": data.experience_descriptions,
        "skills": data.skills,
        "languages": data.languages,
    }
    background_tasks.add_task(
        _generate_resume_files, entity_id, org_id, user_id, candidate_data
    )

    return MagicButtonResponse(
        success=True,
        entity_id=entity.id,
        is_duplicate=is_duplicate,
        duplicate_info=duplicate_info,
        message="Кандидат добавлен" + (" (дубликат найден)" if is_duplicate else ""),
    )


async def _generate_resume_files(
    entity_id: int, org_id: int, user_id: int, candidate_data: dict
):
    """Background task: AI summary → PDF → JPEG → attach to entity."""
    from ..database import AsyncSessionLocal
    from ..services.resume_generator import (
        generate_ai_summary, generate_candidate_pdf, pdf_to_jpeg,
    )

    try:
        logger.info(f"Generating AI resume for entity {entity_id}...")

        # 1. AI summary
        markdown = await generate_ai_summary(candidate_data)
        logger.info(f"AI summary generated for entity {entity_id}: {len(markdown)} chars")

        # 2. PDF
        candidate_name = candidate_data.get("full_name", "Кандидат")
        pdf_bytes = generate_candidate_pdf(markdown, candidate_name)
        logger.info(f"PDF generated for entity {entity_id}: {len(pdf_bytes)} bytes")

        # 3. PDF → JPEG pages
        jpeg_pages = pdf_to_jpeg(pdf_bytes, dpi=200)
        logger.info(f"Converted to {len(jpeg_pages)} JPEG pages for entity {entity_id}")

        # 4. Save to DB
        async with AsyncSessionLocal() as db:
            # Save PDF
            pdf_file = EntityFile(
                entity_id=entity_id,
                org_id=org_id,
                file_type=EntityFileType.resume,
                file_name=f"Профиль_{candidate_name.replace(' ', '_')}.pdf",
                file_path="",
                file_size=len(pdf_bytes),
                mime_type="application/pdf",
                description="AI-сгенерированный профиль кандидата",
                uploaded_by=user_id,
                file_data=pdf_bytes,
            )
            db.add(pdf_file)

            # Save JPEG pages
            for i, jpg_bytes in enumerate(jpeg_pages):
                jpg_file = EntityFile(
                    entity_id=entity_id,
                    org_id=org_id,
                    file_type=EntityFileType.resume,
                    file_name=f"Профиль_{candidate_name.replace(' ', '_')}_стр{i+1}.jpg",
                    file_path="",
                    file_size=len(jpg_bytes),
                    mime_type="image/jpeg",
                    description=f"AI-профиль (стр. {i+1})",
                    uploaded_by=user_id,
                    file_data=jpg_bytes,
                )
                db.add(jpg_file)

            await db.commit()
            logger.info(
                f"Resume files saved for entity {entity_id}: "
                f"1 PDF + {len(jpeg_pages)} JPEGs"
            )

    except Exception as e:
        logger.error(f"Resume generation failed for entity {entity_id}: {e}", exc_info=True)

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
