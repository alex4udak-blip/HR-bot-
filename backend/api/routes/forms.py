"""
API routes for form constructor — create custom forms, public submission by candidates.
"""
import re
import uuid
import json
import mimetypes
import logging
from typing import Optional, List
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, File, Form, UploadFile
from sqlalchemy import select, func, update
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from ..database import get_db
from ..models.database import (
    FormTemplate, FormSubmission, FormVacancy,
    Entity, EntityType, EntityStatus,
    EntityFile, EntityFileType,
    Vacancy, VacancyApplication, ApplicationStage,
    User, UserRole, Organization, OrgMember
)
from ..services.auth import get_current_user, get_user_org

# File upload settings for public forms
ENTITY_FILES_DIR = Path(__file__).parent.parent.parent / "uploads" / "entity_files"
PUBLIC_MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB per file for public forms
PUBLIC_MAX_FILES = 5  # Max files per public form submission
ALLOWED_EXTENSIONS = {".pdf", ".doc", ".docx", ".jpg", ".jpeg", ".png", ".webp"}
PDF_RENDER_DPI = 200

logger = logging.getLogger("hr-analyzer.forms")

router = APIRouter()


# ============================================================
# Pydantic schemas
# ============================================================

class FormFieldSchema(BaseModel):
    id: str
    type: str  # text, email, phone, textarea, select, multiselect, radio, file, url
    label: str
    required: bool = False
    placeholder: Optional[str] = None
    options: Optional[List[str]] = None


class FormCreateSchema(BaseModel):
    title: str
    description: Optional[str] = None
    vacancy_id: Optional[int] = None  # legacy single vacancy
    vacancy_ids: Optional[List[int]] = None  # multiple vacancies
    fields: List[FormFieldSchema] = []
    is_active: bool = True


class FormUpdateSchema(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    vacancy_id: Optional[int] = None  # legacy single vacancy
    vacancy_ids: Optional[List[int]] = None  # multiple vacancies
    fields: Optional[List[FormFieldSchema]] = None
    is_active: Optional[bool] = None


class PublicSubmitSchema(BaseModel):
    data: dict  # {field_id: value}


# ============================================================
# Helpers
# ============================================================

# Transliteration map for Russian to Latin
_TRANSLIT = {
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo',
    'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm',
    'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u',
    'ф': 'f', 'х': 'kh', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'shch',
    'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya',
}


def generate_slug(title: str) -> str:
    """Generate URL-friendly slug from title (supports Russian)."""
    text = title.lower().strip()
    # Transliterate Russian characters
    result = []
    for char in text:
        if char in _TRANSLIT:
            result.append(_TRANSLIT[char])
        elif char.isascii() and (char.isalnum() or char in ('-', '_', ' ')):
            result.append(char)
        elif char == ' ':
            result.append('-')
        else:
            result.append('')
    slug = ''.join(result)
    # Collapse multiple hyphens
    slug = re.sub(r'-+', '-', slug).strip('-')
    # Add short unique suffix to avoid collisions
    suffix = uuid.uuid4().hex[:6]
    return f"{slug}-{suffix}" if slug else suffix


# ============================================================
# Authenticated routes — CRUD for form templates
# ============================================================

@router.get("")
async def list_forms(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List forms created by current user (or all for superadmin)."""
    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)

    query = select(FormTemplate)

    if current_user.role == UserRole.superadmin:
        # Superadmin sees all
        pass
    elif org:
        query = query.where(FormTemplate.org_id == org.id)
    else:
        query = query.where(FormTemplate.created_by == current_user.id)

    query = query.order_by(FormTemplate.created_at.desc())
    result = await db.execute(query)
    forms = result.scalars().all()

    # Get submission counts
    form_ids = [f.id for f in forms]
    counts = {}
    fv_map = {}  # form_id -> [vacancy_ids]
    if form_ids:
        count_result = await db.execute(
            select(FormSubmission.form_id, func.count(FormSubmission.id))
            .where(FormSubmission.form_id.in_(form_ids))
            .group_by(FormSubmission.form_id)
        )
        counts = dict(count_result.all())

        # Get vacancy_ids for each form via junction table
        fv_result = await db.execute(
            select(FormVacancy.form_id, FormVacancy.vacancy_id)
            .where(FormVacancy.form_id.in_(form_ids))
        )
        for fid, vid in fv_result.all():
            fv_map.setdefault(fid, []).append(vid)

    return [
        {
            "id": f.id,
            "title": f.title,
            "description": f.description,
            "slug": f.slug,
            "vacancy_id": f.vacancy_id,
            "vacancy_ids": fv_map.get(f.id, [f.vacancy_id] if f.vacancy_id else []),
            "is_active": f.is_active,
            "fields": f.fields or [],
            "submissions_count": counts.get(f.id, 0),
            "created_at": f.created_at.isoformat() if f.created_at else None,
            "updated_at": f.updated_at.isoformat() if f.updated_at else None,
            "created_by": f.created_by,
        }
        for f in forms
    ]


@router.post("")
async def create_form(
    body: FormCreateSchema,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a new form template."""
    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(status_code=400, detail="User has no organization")

    slug = generate_slug(body.title)

    # Resolve vacancy_ids from both legacy and new fields
    vacancy_ids = body.vacancy_ids or ([body.vacancy_id] if body.vacancy_id else [])

    form = FormTemplate(
        org_id=org.id,
        vacancy_id=vacancy_ids[0] if vacancy_ids else None,  # legacy compat
        created_by=current_user.id,
        title=body.title,
        description=body.description,
        slug=slug,
        is_active=body.is_active,
        fields=[f.model_dump() for f in body.fields],
    )
    db.add(form)
    await db.flush()

    # Create many-to-many links
    for vid in vacancy_ids:
        db.add(FormVacancy(form_id=form.id, vacancy_id=vid))

    await db.commit()
    await db.refresh(form)

    return {
        "id": form.id,
        "title": form.title,
        "description": form.description,
        "slug": form.slug,
        "vacancy_id": form.vacancy_id,
        "vacancy_ids": vacancy_ids,
        "is_active": form.is_active,
        "fields": form.fields or [],
        "submissions_count": 0,
        "created_at": form.created_at.isoformat() if form.created_at else None,
        "updated_at": form.updated_at.isoformat() if form.updated_at else None,
        "created_by": form.created_by,
    }


@router.get("/{form_id}")
async def get_form(
    form_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get form template with submission count."""
    current_user = await db.merge(current_user)
    result = await db.execute(select(FormTemplate).where(FormTemplate.id == form_id))
    form = result.scalar_one_or_none()
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")

    # Check access
    org = await get_user_org(current_user, db)
    if current_user.role != UserRole.superadmin:
        if not org or form.org_id != org.id:
            raise HTTPException(status_code=403, detail="Access denied")

    count_result = await db.execute(
        select(func.count(FormSubmission.id)).where(FormSubmission.form_id == form.id)
    )
    submissions_count = count_result.scalar() or 0

    return {
        "id": form.id,
        "title": form.title,
        "description": form.description,
        "slug": form.slug,
        "vacancy_id": form.vacancy_id,
        "is_active": form.is_active,
        "fields": form.fields or [],
        "submissions_count": submissions_count,
        "created_at": form.created_at.isoformat() if form.created_at else None,
        "updated_at": form.updated_at.isoformat() if form.updated_at else None,
        "created_by": form.created_by,
    }


@router.put("/{form_id}")
async def update_form(
    form_id: int,
    body: FormUpdateSchema,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update form template."""
    current_user = await db.merge(current_user)
    result = await db.execute(select(FormTemplate).where(FormTemplate.id == form_id))
    form = result.scalar_one_or_none()
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")

    org = await get_user_org(current_user, db)
    if current_user.role != UserRole.superadmin:
        if not org or form.org_id != org.id:
            raise HTTPException(status_code=403, detail="Access denied")

    if body.title is not None:
        form.title = body.title
    if body.description is not None:
        form.description = body.description
    if body.fields is not None:
        form.fields = [f.model_dump() for f in body.fields]
    if body.is_active is not None:
        form.is_active = body.is_active

    # Handle multi-vacancy update
    vacancy_ids = None
    if body.vacancy_ids is not None:
        vacancy_ids = body.vacancy_ids
    elif body.vacancy_id is not None:
        vacancy_ids = [body.vacancy_id] if body.vacancy_id else []

    if vacancy_ids is not None:
        form.vacancy_id = vacancy_ids[0] if vacancy_ids else None  # legacy compat
        # Replace junction table entries
        await db.execute(
            select(FormVacancy).where(FormVacancy.form_id == form.id)
        )
        from sqlalchemy import delete
        await db.execute(delete(FormVacancy).where(FormVacancy.form_id == form.id))
        for vid in vacancy_ids:
            db.add(FormVacancy(form_id=form.id, vacancy_id=vid))

    await db.commit()
    await db.refresh(form)

    # Get current vacancy_ids
    fv_result = await db.execute(
        select(FormVacancy.vacancy_id).where(FormVacancy.form_id == form.id)
    )
    current_vacancy_ids = [row[0] for row in fv_result.all()]

    count_result = await db.execute(
        select(func.count(FormSubmission.id)).where(FormSubmission.form_id == form.id)
    )
    submissions_count = count_result.scalar() or 0

    return {
        "id": form.id,
        "title": form.title,
        "description": form.description,
        "slug": form.slug,
        "vacancy_id": form.vacancy_id,
        "vacancy_ids": current_vacancy_ids,
        "is_active": form.is_active,
        "fields": form.fields or [],
        "submissions_count": submissions_count,
        "created_at": form.created_at.isoformat() if form.created_at else None,
        "updated_at": form.updated_at.isoformat() if form.updated_at else None,
        "created_by": form.created_by,
    }


@router.delete("/{form_id}")
async def delete_form(
    form_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete form template."""
    current_user = await db.merge(current_user)
    result = await db.execute(select(FormTemplate).where(FormTemplate.id == form_id))
    form = result.scalar_one_or_none()
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")

    org = await get_user_org(current_user, db)
    if current_user.role != UserRole.superadmin:
        if not org or form.org_id != org.id:
            raise HTTPException(status_code=403, detail="Access denied")

    await db.delete(form)
    await db.commit()
    return {"ok": True}


# ============================================================
# Submissions (authenticated)
# ============================================================

@router.get("/{form_id}/submissions")
async def list_submissions(
    form_id: int,
    limit: int = Query(50, le=200),
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List form submissions with linked entities."""
    current_user = await db.merge(current_user)
    result = await db.execute(select(FormTemplate).where(FormTemplate.id == form_id))
    form = result.scalar_one_or_none()
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")

    org = await get_user_org(current_user, db)
    if current_user.role != UserRole.superadmin:
        if not org or form.org_id != org.id:
            raise HTTPException(status_code=403, detail="Access denied")

    query = (
        select(FormSubmission)
        .where(FormSubmission.form_id == form_id)
        .order_by(FormSubmission.submitted_at.desc())
        .offset(offset)
        .limit(limit)
    )
    subs = await db.execute(query)
    submissions = subs.scalars().all()

    # Get linked entities
    entity_ids = [s.entity_id for s in submissions if s.entity_id]
    entities_map = {}
    if entity_ids:
        ent_result = await db.execute(
            select(Entity).where(Entity.id.in_(entity_ids))
        )
        for e in ent_result.scalars().all():
            entities_map[e.id] = {"id": e.id, "name": e.name, "email": e.email, "status": e.status.value if e.status else None}

    return [
        {
            "id": s.id,
            "form_id": s.form_id,
            "entity_id": s.entity_id,
            "entity": entities_map.get(s.entity_id) if s.entity_id else None,
            "data": s.data,
            "submitted_at": s.submitted_at.isoformat() if s.submitted_at else None,
        }
        for s in submissions
    ]


# ============================================================
# Public routes — NO AUTH (candidate fills form)
# ============================================================

@router.get("/public/{slug}")
async def get_public_form(
    slug: str,
    db: AsyncSession = Depends(get_db),
):
    """Get form fields for public display (no auth required)."""
    result = await db.execute(
        select(FormTemplate).where(FormTemplate.slug == slug, FormTemplate.is_active == True)
    )
    form = result.scalar_one_or_none()
    if not form:
        raise HTTPException(status_code=404, detail="Форма не найдена")

    # Get vacancy title if linked
    vacancy_title = None
    if form.vacancy_id:
        vac_result = await db.execute(select(Vacancy.title).where(Vacancy.id == form.vacancy_id))
        vacancy_title = vac_result.scalar_one_or_none()

    return {
        "id": form.id,
        "title": form.title,
        "description": form.description,
        "fields": form.fields or [],
        "vacancy_title": vacancy_title,
    }


@router.post("/public/{slug}/submit")
async def submit_public_form(
    slug: str,
    body: PublicSubmitSchema,
    db: AsyncSession = Depends(get_db),
):
    """Submit a form publicly (no auth). Creates entity + links to vacancy."""
    result = await db.execute(
        select(FormTemplate).where(FormTemplate.slug == slug, FormTemplate.is_active == True)
    )
    form = result.scalar_one_or_none()
    if not form:
        raise HTTPException(status_code=404, detail="Форма не найдена")

    fields_by_id = {f["id"]: f for f in (form.fields or [])}

    # Validate required fields
    for field in (form.fields or []):
        if field.get("required"):
            val = body.data.get(field["id"])
            if val is None or (isinstance(val, str) and not val.strip()):
                raise HTTPException(
                    status_code=422,
                    detail=f"Поле '{field['label']}' обязательно для заполнения"
                )

    # Extract name and email from known field types
    candidate_name = None
    candidate_email = None
    candidate_phone = None

    for field_id, value in body.data.items():
        field_def = fields_by_id.get(field_id)
        if not field_def:
            continue
        ftype = field_def.get("type", "")
        if ftype == "email" and value:
            candidate_email = str(value).strip()
        elif ftype == "phone" and value:
            candidate_phone = str(value).strip()
        elif ftype == "text" and not candidate_name and value:
            # Use first text field as name
            candidate_name = str(value).strip()

    if not candidate_name:
        candidate_name = candidate_email or "Без имени"

    # Create Entity (candidate)
    entity = Entity(
        org_id=form.org_id,
        type=EntityType.candidate,
        name=candidate_name,
        status=EntityStatus.new,
        email=candidate_email,
        phone=candidate_phone,
        created_by=form.created_by,
        extra_data={"source": "form", "form_id": form.id, "form_title": form.title},
    )
    db.add(entity)
    await db.flush()  # Get entity.id

    # Create FormSubmission
    submission = FormSubmission(
        form_id=form.id,
        entity_id=entity.id,
        data=body.data,
    )
    db.add(submission)

    # Get all linked vacancies (via junction table, fallback to legacy vacancy_id)
    fv_result = await db.execute(
        select(FormVacancy.vacancy_id).where(FormVacancy.form_id == form.id)
    )
    linked_vacancy_ids = [row[0] for row in fv_result.all()]
    if not linked_vacancy_ids and form.vacancy_id:
        linked_vacancy_ids = [form.vacancy_id]

    # Create VacancyApplication for each linked vacancy
    linked_vacancies = []
    if linked_vacancy_ids:
        vac_result = await db.execute(
            select(Vacancy).where(Vacancy.id.in_(linked_vacancy_ids))
        )
        linked_vacancies = list(vac_result.scalars().all())
        for vacancy in linked_vacancies:
            application = VacancyApplication(
                vacancy_id=vacancy.id,
                entity_id=entity.id,
                stage=ApplicationStage.applied,
                source="form",
                created_by=form.created_by,
            )
            db.add(application)

    await db.commit()

    # --- Notification: new candidate from public form ---
    for vacancy in linked_vacancies:
        try:
            from ..services.hr_notifications import notify_new_candidate
            creator_result = await db.execute(
                select(User).where(User.id == form.created_by)
            )
            form_creator = creator_result.scalar_one_or_none()
            if form_creator:
                await notify_new_candidate(db, entity, vacancy, form_creator)
        except Exception:
            logger.exception("notify_new_candidate (form) failed (non-critical)")

    return {"message": "Спасибо! Ваша анкета успешно отправлена.", "entity_id": entity.id}


@router.post("/public/{slug}/submit-with-files")
async def submit_public_form_with_files(
    slug: str,
    data: str = Form(..., description="JSON string with form data {field_id: value}"),
    files: List[UploadFile] = File(default=[]),
    db: AsyncSession = Depends(get_db),
):
    """Submit a form publicly with file attachments (no auth).

    Accepts multipart/form-data with:
    - data: JSON string of form field values
    - files: uploaded files (resume, CV, etc.)
    """
    # Parse JSON data
    try:
        form_data = json.loads(data)
    except json.JSONDecodeError:
        raise HTTPException(status_code=422, detail="Невалидный JSON в поле data")

    # Find form
    result = await db.execute(
        select(FormTemplate).where(FormTemplate.slug == slug, FormTemplate.is_active == True)
    )
    form = result.scalar_one_or_none()
    if not form:
        raise HTTPException(status_code=404, detail="Форма не найдена")

    fields_by_id = {f["id"]: f for f in (form.fields or [])}

    # Validate required fields (skip file fields — they come separately)
    for field in (form.fields or []):
        if field.get("required") and field.get("type") != "file":
            val = form_data.get(field["id"])
            if val is None or (isinstance(val, str) and not val.strip()):
                raise HTTPException(
                    status_code=422,
                    detail=f"Поле '{field['label']}' обязательно для заполнения"
                )

    # Extract name, email, phone
    candidate_name = None
    candidate_email = None
    candidate_phone = None

    for field_id, value in form_data.items():
        field_def = fields_by_id.get(field_id)
        if not field_def:
            continue
        ftype = field_def.get("type", "")
        if ftype == "email" and value:
            candidate_email = str(value).strip()
        elif ftype == "phone" and value:
            candidate_phone = str(value).strip()
        elif ftype == "text" and not candidate_name and value:
            candidate_name = str(value).strip()

    if not candidate_name:
        candidate_name = candidate_email or "Без имени"

    # Create Entity
    entity = Entity(
        org_id=form.org_id,
        type=EntityType.candidate,
        name=candidate_name,
        status=EntityStatus.new,
        email=candidate_email,
        phone=candidate_phone,
        created_by=form.created_by,
        extra_data={"source": "form", "form_id": form.id, "form_title": form.title},
    )
    db.add(entity)
    await db.flush()

    # Create FormSubmission
    submission = FormSubmission(
        form_id=form.id,
        entity_id=entity.id,
        data=form_data,
    )
    db.add(submission)

    # Save uploaded files
    saved_files = []
    if files:
        entity_files_dir = ENTITY_FILES_DIR / str(entity.id)
        entity_files_dir.mkdir(parents=True, exist_ok=True)

        for i, upload_file in enumerate(files[:PUBLIC_MAX_FILES]):
            if not upload_file.filename:
                continue

            original_name = upload_file.filename
            ext = Path(original_name.lower()).suffix
            if ext not in ALLOWED_EXTENSIONS:
                logger.warning(f"Public form: skipped disallowed file type '{ext}' ({original_name})")
                continue

            content = await upload_file.read()
            file_size = len(content)
            if file_size > PUBLIC_MAX_FILE_SIZE or file_size == 0:
                continue

            content_type = upload_file.content_type or mimetypes.guess_type(original_name)[0] or "application/octet-stream"
            unique_name = f"{uuid.uuid4().hex}{ext}"
            file_path = entity_files_dir / unique_name

            with open(file_path, "wb") as f:
                f.write(content)

            # Determine file_type: if it looks like a resume/CV
            is_resume = any(kw in original_name.lower() for kw in ["resume", "cv", "резюме"])
            file_type = EntityFileType.resume if is_resume else EntityFileType.other

            entity_file = EntityFile(
                entity_id=entity.id,
                file_type=file_type,
                file_name=original_name,
                file_path=str(file_path),
                file_size=file_size,
                mime_type=content_type,
                description=f"Загружено через форму '{form.title}'",
                uploaded_by=form.created_by,
            )
            db.add(entity_file)
            saved_files.append((entity_file, file_path, content_type))

        await db.flush()

        # Convert PDF resumes to images for inline preview
        for entity_file, fpath, ctype in saved_files:
            if ctype == "application/pdf" and entity_file.file_type == EntityFileType.resume:
                try:
                    import fitz
                    doc = fitz.open(str(fpath))
                    for page_num in range(len(doc)):
                        page = doc[page_num]
                        mat = fitz.Matrix(PDF_RENDER_DPI / 72, PDF_RENDER_DPI / 72)
                        pix = page.get_pixmap(matrix=mat)
                        img_name = f"{uuid.uuid4().hex}.jpg"
                        img_path = entity_files_dir / img_name
                        pix.save(str(img_path))

                        img_file = EntityFile(
                            entity_id=entity.id,
                            file_type=EntityFileType.resume,
                            file_name=f"{Path(original_name).stem}_page_{page_num + 1}.jpg",
                            file_path=str(img_path),
                            file_size=img_path.stat().st_size,
                            mime_type="image/jpeg",
                            description=f"Страница {page_num + 1} из {original_name}",
                            uploaded_by=form.created_by,
                        )
                        db.add(img_file)
                    doc.close()
                except Exception:
                    logger.exception(f"PDF→image conversion failed for {fpath}")

    # Get all linked vacancies (via junction table, fallback to legacy vacancy_id)
    fv_result = await db.execute(
        select(FormVacancy.vacancy_id).where(FormVacancy.form_id == form.id)
    )
    linked_vacancy_ids = [row[0] for row in fv_result.all()]
    if not linked_vacancy_ids and form.vacancy_id:
        linked_vacancy_ids = [form.vacancy_id]

    # Create VacancyApplication for each linked vacancy
    linked_vacancies = []
    if linked_vacancy_ids:
        vac_result = await db.execute(
            select(Vacancy).where(Vacancy.id.in_(linked_vacancy_ids))
        )
        linked_vacancies = list(vac_result.scalars().all())
        for vacancy in linked_vacancies:
            application = VacancyApplication(
                vacancy_id=vacancy.id,
                entity_id=entity.id,
                stage=ApplicationStage.applied,
                source="form",
                created_by=form.created_by,
            )
            db.add(application)

    await db.commit()

    # Notification
    for vacancy in linked_vacancies:
        try:
            from ..services.hr_notifications import notify_new_candidate
            creator_result = await db.execute(
                select(User).where(User.id == form.created_by)
            )
            form_creator = creator_result.scalar_one_or_none()
            if form_creator:
                await notify_new_candidate(db, entity, vacancy, form_creator)
        except Exception:
            logger.exception("notify_new_candidate (form+files) failed (non-critical)")

    return {
        "message": "Спасибо! Ваша анкета успешно отправлена.",
        "entity_id": entity.id,
        "files_saved": len(saved_files),
    }
