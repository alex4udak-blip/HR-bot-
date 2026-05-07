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
    User, Vacancy, VacancyStatus, VacancyApplication, ApplicationStage, StageTransition,
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
    photo_url: Optional[str] = None
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
    company: Optional[str] = None
    education: Optional[list] = None

    # Recruiter's choice
    vacancy_id: Optional[int] = None  # which funnel to add to
    comment: Optional[str] = None

class MagicButtonResponse(BaseModel):
    success: bool
    entity_id: int
    is_duplicate: bool = False
    duplicate_info: Optional[dict] = None  # who added, when, last status
    message: str

class UpdatePhotoRequest(BaseModel):
    photo_url: str


@router.post("/entity/{entity_id}/photo")
async def update_entity_photo(
    entity_id: int,
    data: UpdatePhotoRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update the photo_url stored in an entity's extra_data.

    Used by the Chrome extension to backfill a photo on an already-added
    candidate without going through the full /parse flow.
    """
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(400, "User not in organization")
    result = await db.execute(
        select(Entity).where(Entity.id == entity_id, Entity.org_id == org.id)
    )
    entity = result.scalar_one_or_none()
    if not entity:
        raise HTTPException(404, "Candidate not found")
    ed = dict(entity.extra_data or {})
    ed["photo_url"] = data.photo_url
    entity.extra_data = ed
    await db.commit()
    return {"success": True, "photo_url": data.photo_url}


class DuplicateCheckRequest(BaseModel):
    full_name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    telegram: Optional[str] = None
    source_url: Optional[str] = None

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
    # Primary identifier: resume URL (works even when contacts are hidden).
    if data.source_url:
        conditions.append(Entity.extra_data.op('->>')('source_url') == data.source_url)
    if data.email:
        conditions.append(Entity.email == data.email)
    if data.phone:
        conditions.append(Entity.phone == data.phone)
    if data.telegram:
        conditions.append(Entity.telegram_usernames.cast(String).ilike(f"%{data.telegram.lower()}%"))
    # Name match — skip for generic placeholders so every "Кандидат ..."
    # doesn't match every other placeholder in the DB.
    name_lower = (data.full_name or "").strip().lower()
    is_placeholder_name = name_lower.startswith("кандидат")
    if data.full_name and not is_placeholder_name:
        name_parts = data.full_name.strip().split()
        if len(name_parts) >= 2:
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

    # For each duplicate, load their work history: vacancy applications + recent stage transitions
    result_list = []
    for d in duplicates:
        # All vacancy applications for this candidate
        apps_result = await db.execute(
            select(VacancyApplication, Vacancy.title)
            .join(Vacancy, Vacancy.id == VacancyApplication.vacancy_id)
            .where(VacancyApplication.entity_id == d.id)
            .order_by(VacancyApplication.applied_at.desc())
        )
        applications = []
        for app, vacancy_title in apps_result.all():
            applications.append({
                "vacancy_id": app.vacancy_id,
                "vacancy_title": vacancy_title,
                "stage": app.stage.value if app.stage else "applied",
                "rating": app.rating,
                "applied_at": app.applied_at.isoformat() if app.applied_at else None,
                "last_stage_change_at": app.last_stage_change_at.isoformat() if app.last_stage_change_at else None,
            })

        # Recent stage transitions (last 10) — quick history view
        trans_result = await db.execute(
            select(StageTransition)
            .where(StageTransition.entity_id == d.id)
            .order_by(StageTransition.created_at.desc())
            .limit(10)
        )
        transitions = [
            {
                "from_stage": t.from_stage,
                "to_stage": t.to_stage,
                "created_at": t.created_at.isoformat() if t.created_at else None,
            }
            for t in trans_result.scalars().all()
        ]

        result_list.append({
            "entity_id": d.id,
            "name": d.name,
            "email": d.email,
            "phone": d.phone,
            "status": d.status.value if d.status else "unknown",
            "created_at": d.created_at.isoformat() if d.created_at else None,
            "applications": applications,
            "recent_transitions": transitions,
        })

    return DuplicateCheckResponse(
        is_duplicate=len(duplicates) > 0,
        duplicates=result_list,
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

    # Log incoming photo_url so Railway logs show whether extension sent it
    logger.info(
        f"magic-button parse: source={data.source} url={data.source_url} "
        f"photo_url={'<yes>' if data.photo_url else '<no>'} "
        f"({(data.photo_url or '')[:100]})"
    )

    # Check for duplicates — prefer source_url (unique per resume, reliable
    # even when contacts are hidden on hh.ru), then fall back to contact-based
    # matching. Name-based matching is skipped if the name looks like a generic
    # placeholder so we don't collapse all "Кандидат" entries into one record.
    duplicate = None
    if data.source_url:
        dup_by_url = await db.execute(
            select(Entity).where(
                Entity.org_id == org.id,
                Entity.type == EntityType.candidate,
                Entity.extra_data.op('->>')('source_url') == data.source_url,
            ).limit(1)
        )
        duplicate = dup_by_url.scalar_one_or_none()

    if duplicate is None:
        conditions = []
        if data.email:
            conditions.append(Entity.email == data.email)
        if data.phone:
            conditions.append(Entity.phone == data.phone)
        if data.telegram:
            # telegram_usernames is a JSON array, check if it contains the value
            conditions.append(Entity.telegram_usernames.cast(String).ilike(f"%{data.telegram.lower()}%"))
        # Name match ONLY when the name is specific (not a "Кандидат ..." placeholder)
        name_lower = (data.full_name or "").strip().lower()
        is_placeholder_name = name_lower.startswith("кандидат")
        if data.full_name and not is_placeholder_name:
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
    # Если рекрут написал коммент в попапе расширения — кладём его в notes-массив
    # (тот же формат что использует /all-candidates → блок "Комментарии").
    # Иначе коммент висит только в extra_data.comment и нигде не отображается.
    if data.comment and data.comment.strip():
        import uuid
        from datetime import timezone as _tz
        extra["notes"] = [{
            "id": str(uuid.uuid4()),
            "text": data.comment.strip(),
            "date": datetime.now(_tz.utc).isoformat(),
            "stage": "new",
            "stage_label": "Новый",
            "author_id": current_user.id,
            "author_name": current_user.name,
        }]
    if data.photo_url:
        extra["photo_url"] = data.photo_url
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
    if data.education:
        extra["education"] = data.education

    # Parse salary into min/max if possible
    salary_min = None
    salary_max = None
    salary_currency = 'KZT'
    if data.salary:
        import re
        # Detect currency
        sal_text = data.salary.lower()
        if 'usd' in sal_text or '$' in sal_text:
            salary_currency = 'USD'
        elif 'eur' in sal_text or '€' in sal_text:
            salary_currency = 'EUR'
        elif 'руб' in sal_text or '₽' in sal_text:
            salary_currency = 'RUB'
        elif 'тенге' in sal_text or 'kzt' in sal_text or '₸' in sal_text:
            salary_currency = 'KZT'
        # Extract numbers — HH formats with various whitespace separators
        # (regular space, U+00A0 no-break, U+2009 thin space, U+202F narrow nbsp)
        # so we strip all whitespace-ish chars before int().
        def _to_int(s):
            cleaned = re.sub(r'\D', '', s)
            return int(cleaned) if cleaned else 0
        numbers = re.findall(r'[\d\s\u00A0\u2009\u202F]+', data.salary)
        nums = [_to_int(n) for n in numbers if any(c.isdigit() for c in n)]
        nums = [n for n in nums if n > 100]
        if len(nums) >= 2:
            salary_min = min(nums)
            salary_max = max(nums)
        elif len(nums) == 1:
            if 'от' in sal_text:
                salary_min = nums[0]
            elif 'до' in sal_text:
                salary_max = nums[0]
            else:
                salary_min = nums[0]
                salary_max = nums[0]

    entity = Entity(
        org_id=org.id,
        type=EntityType.candidate,
        name=data.full_name,
        status=EntityStatus.new,
        email=data.email,
        phone=data.phone,
        position=data.position,
        company=data.company or None,
        telegram_usernames=tg_list,
        expected_salary_min=salary_min,
        expected_salary_max=salary_max,
        expected_salary_currency=salary_currency,
        extra_data=extra,
        created_by=current_user.id,
    )
    db.add(entity)
    await db.flush()

    # Add to vacancy/funnel if specified.
    # Если выбранная вакансия — это заявка (request), а у текущего рекрутёра
    # уже есть свой клон этой заявки (взял её в работу), кладём кандидата
    # в КЛОН — иначе он не появится в /my-funnels у рекрутёра, application
    # будет лежать на оригинале, а в воронке «Мои вакансии» виден клон.
    target_vacancy_id = data.vacancy_id
    if target_vacancy_id:
        from sqlalchemy import text as _text
        clone_q = await db.execute(
            select(Vacancy.id).where(
                Vacancy.created_by == current_user.id,
                _text(
                    f"vacancies.extra_data::jsonb @> "
                    f"'{{\"cloned_from_request_id\": {int(target_vacancy_id)}}}'::jsonb"
                ),
            ).limit(1)
        )
        my_clone_id = clone_q.scalar_one_or_none()
        if my_clone_id:
            target_vacancy_id = my_clone_id

        app = VacancyApplication(
            vacancy_id=target_vacancy_id,
            entity_id=entity.id,
            stage=ApplicationStage.applied,
            source=data.source,
        )
        db.add(app)

    await db.commit()

    # --- Notification: new candidate from magic button ---
    if target_vacancy_id:
        try:
            from ..services.hr_notifications import notify_new_candidate
            vac_result = await db.execute(
                select(Vacancy).where(Vacancy.id == target_vacancy_id)
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
        "photo_url": data.photo_url,
    }
    background_tasks.add_task(
        _generate_resume_files, entity_id, org_id, user_id, candidate_data
    )
    # Отдельный быстрый таск: скачать фото и сохранить как EntityFile.
    # AI-резюме длится дольше и может упасть (нет API-ключа, парс ошибки и т.д.) —
    # фото так бы пропало. Этот таск делает только photo download → fast.
    if data.photo_url:
        background_tasks.add_task(
            _download_candidate_photo_eager, entity_id, org_id, user_id, data.photo_url, data.full_name
        )

    return MagicButtonResponse(
        success=True,
        entity_id=entity.id,
        is_duplicate=is_duplicate,
        duplicate_info=duplicate_info,
        message="Кандидат добавлен" + (" (дубликат найден)" if is_duplicate else ""),
    )


async def _download_candidate_photo_eager(
    entity_id: int, org_id: int, user_id: int, photo_url: str, candidate_name: str
):
    """Быстрый background-task: только скачивает фото с hh.ru и сохраняет
    как EntityFile. Запускается сразу после создания кандидата, не зависит от
    AI-резюме (который может упасть из-за API/парсера). Идемпотентно: если у
    entity уже есть photo-файл, пропускает.
    """
    from ..database import AsyncSessionLocal
    try:
        async with AsyncSessionLocal() as db:
            # Skip if photo file already exists for this entity
            existing = await db.execute(
                select(EntityFile.id).where(
                    EntityFile.entity_id == entity_id,
                    EntityFile.mime_type.startswith("image/"),
                ).limit(1)
            )
            if existing.scalar():
                logger.info(f"Photo file already exists for entity {entity_id}, skip eager download")
                return

            import httpx
            async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
                resp = await client.get(photo_url, headers={"User-Agent": "Mozilla/5.0"})
                if resp.status_code != 200:
                    logger.warning(f"Eager photo download failed for entity {entity_id}: HTTP {resp.status_code}")
                    return
                ct = resp.headers.get("content-type", "").lower().split(";")[0].strip()
                if not ct.startswith("image/"):
                    logger.warning(f"Eager photo download non-image content-type: {ct} for entity {entity_id}")
                    return
                photo_bytes = resp.content

            ext = {
                "image/jpeg": "jpg", "image/jpg": "jpg",
                "image/png": "png", "image/webp": "webp",
            }.get(ct, "jpg")
            photo_file = EntityFile(
                entity_id=entity_id,
                org_id=org_id,
                file_type=EntityFileType.other,
                file_name=f"Фото_{(candidate_name or 'кандидат').replace(' ', '_')}.{ext}",
                file_path="",
                file_size=len(photo_bytes),
                mime_type=ct,
                description="Фото кандидата (HH, eager)",
                uploaded_by=user_id,
                file_data=photo_bytes,
            )
            db.add(photo_file)
            await db.commit()
            logger.info(f"Eager photo saved for entity {entity_id}: {len(photo_bytes)} bytes, {ct}")
    except Exception as e:
        logger.warning(f"Eager photo download crashed for entity {entity_id}: {type(e).__name__}: {e}")


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

        # 1b. Download photo if URL was parsed by the extension. Photo is used
        # both inside the PDF and saved as a separate image file on the entity
        # so the UI can load it from files even if extra_data.photo_url is lost.
        photo_bytes = None
        photo_mime = None
        photo_url = candidate_data.get("photo_url")
        if photo_url:
            try:
                import httpx
                async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
                    resp = await client.get(photo_url)
                    if resp.status_code == 200:
                        ct = resp.headers.get("content-type", "").lower()
                        if ct.startswith("image/"):
                            photo_bytes = resp.content
                            photo_mime = ct.split(";")[0].strip()
                            logger.info(
                                f"Downloaded candidate photo for entity {entity_id}: "
                                f"{len(photo_bytes)} bytes, {photo_mime}"
                            )
                        else:
                            logger.warning(f"Photo URL returned non-image content-type: {ct}")
            except Exception as e:
                logger.warning(f"Failed to download photo for entity {entity_id}: {e}")

        # 2. PDF (with photo if we have it)
        candidate_name = candidate_data.get("full_name", "Кандидат")
        pdf_bytes = generate_candidate_pdf(markdown, candidate_name, photo_bytes=photo_bytes)
        logger.info(f"PDF generated for entity {entity_id}: {len(pdf_bytes)} bytes")

        # 3. PDF → JPEG pages
        jpeg_pages = pdf_to_jpeg(pdf_bytes, dpi=200)
        logger.info(f"Converted to {len(jpeg_pages)} JPEG pages for entity {entity_id}")

        # 4. Save to DB
        async with AsyncSessionLocal() as db:
            # Save candidate photo as a standalone image file (when available)
            if photo_bytes and photo_mime:
                ext = {
                    "image/jpeg": "jpg",
                    "image/jpg": "jpg",
                    "image/png": "png",
                    "image/webp": "webp",
                }.get(photo_mime, "jpg")
                photo_file = EntityFile(
                    entity_id=entity_id,
                    org_id=org_id,
                    file_type=EntityFileType.other,
                    file_name=f"Фото_{candidate_name.replace(' ', '_')}.{ext}",
                    file_path="",
                    file_size=len(photo_bytes),
                    mime_type=photo_mime,
                    description="Фото кандидата (HH)",
                    uploaded_by=user_id,
                    file_data=photo_bytes,
                )
                db.add(photo_file)

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
    """Get recruiter's vacancies for the extension popup dropdown.

    Включаем активные статусы: open, pending_review, draft (legacy).
    Исключаем paused/closed/cancelled — туда добавлять кандидатов нельзя.
    pending_review нужен потому что после миграции a1727dd все новые
    вакансии создаются в pending_review до апрува админом, и без
    включения этого статуса дропдаун окажется пустым."""
    org = await get_user_org(current_user, db)
    result = await db.execute(
        select(Vacancy).where(
            Vacancy.org_id == org.id,
            Vacancy.created_by == current_user.id,
            Vacancy.status.in_([
                VacancyStatus.open,
                VacancyStatus.pending_review,
                VacancyStatus.draft,
            ]),
        ).order_by(Vacancy.title)
    )
    vacancies = result.scalars().all()
    return [{"id": v.id, "title": v.title} for v in vacancies]
