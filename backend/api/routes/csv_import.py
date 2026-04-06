"""
API routes for CSV import of candidates (ClickUp, HH.ru, etc.).
"""
import csv
import io
import json
import logging
from typing import Optional, List, Dict, Any

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from ..database import get_db
from ..models.database import (
    Entity, EntityType, EntityStatus,
    VacancyApplication, ApplicationStage,
    User,
)
from ..services.auth import get_current_user, get_user_org

logger = logging.getLogger("hr-analyzer.csv-import")

router = APIRouter()

# ---------------------------------------------------------------------------
# Column auto-detection maps
# ---------------------------------------------------------------------------

COLUMN_ALIASES: Dict[str, List[str]] = {
    "name": ["name", "имя", "фио", "кандидат", "full name", "fullname"],
    "email": ["email", "электронная почта", "e-mail", "почта", "mail"],
    "phone": ["phone", "телефон", "тел", "тел.", "mobile", "мобильный"],
    "position": ["position", "должность", "позиция", "role", "вакансия"],
    "company": ["company", "компания", "организация", "employer"],
    "status": ["status", "статус", "stage", "этап"],
    "tags": ["tags", "теги", "метки", "labels"],
    "telegram": ["telegram", "tg", "телеграм", "telegram username"],
    "source": ["source", "источник", "канал", "откуда"],
    "comment": ["comment", "комментарий", "примечание", "notes", "заметка"],
}

# Reverse lookup: lowered alias -> field name
_ALIAS_MAP: Dict[str, str] = {}
for field, aliases in COLUMN_ALIASES.items():
    for alias in aliases:
        _ALIAS_MAP[alias.lower().strip()] = field


STATUS_MAP: Dict[str, EntityStatus] = {
    "new": EntityStatus.new,
    "новый": EntityStatus.new,
    "screening": EntityStatus.screening,
    "скрининг": EntityStatus.screening,
    "practice": EntityStatus.practice,
    "практика": EntityStatus.practice,
    "tech_practice": EntityStatus.tech_practice,
    "тех-практика": EntityStatus.tech_practice,
    "interview": EntityStatus.is_interview,
    "ис": EntityStatus.is_interview,
    "offer": EntityStatus.offer,
    "оффер": EntityStatus.offer,
    "hired": EntityStatus.hired,
    "принят": EntityStatus.hired,
    "rejected": EntityStatus.rejected,
    "отказ": EntityStatus.rejected,
}


# ---------------------------------------------------------------------------
# Pydantic response models
# ---------------------------------------------------------------------------

class ColumnMapping(BaseModel):
    csv_column: str
    entity_field: Optional[str] = None


class PreviewResponse(BaseModel):
    columns: List[str]
    preview_rows: List[Dict[str, str]]
    suggested_mapping: Dict[str, str]  # csv_column -> entity_field


class ImportErrorDetail(BaseModel):
    row: int
    reason: str


class ImportResult(BaseModel):
    total: int
    imported: int
    skipped: int
    errors_count: int
    errors: List[ImportErrorDetail]


class TemplateMapping(BaseModel):
    name: str
    description: str
    mapping: Dict[str, str]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _read_csv_text(raw: bytes) -> str:
    """Decode CSV bytes handling UTF-8 BOM and common encodings."""
    # Try UTF-8 BOM first
    if raw.startswith(b"\xef\xbb\xbf"):
        return raw[3:].decode("utf-8")
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw.decode("cp1251")


def _auto_detect_mapping(headers: List[str]) -> Dict[str, str]:
    """Return {csv_column: entity_field} for recognised headers."""
    mapping: Dict[str, str] = {}
    for h in headers:
        normalized = h.lower().strip()
        if normalized in _ALIAS_MAP:
            mapping[h] = _ALIAS_MAP[normalized]
    return mapping


def _normalize_telegram(value: str) -> List[str]:
    """Normalize telegram usernames: strip @, lowercase, split by comma."""
    result = []
    for part in value.split(","):
        part = part.strip().lstrip("@").lower()
        if part:
            result.append(part)
    return result


def _parse_tags(value: str) -> List[str]:
    """Split comma-separated tags."""
    return [t.strip() for t in value.split(",") if t.strip()]


def _parse_status(value: str, default: EntityStatus) -> EntityStatus:
    """Try to map a status string to EntityStatus, fall back to default."""
    if not value:
        return default
    normalized = value.lower().strip()
    return STATUS_MAP.get(normalized, default)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/preview", response_model=PreviewResponse)
async def import_preview(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    """Parse uploaded CSV and return column preview with auto-detected mapping."""
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are accepted")

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="File is empty")

    text = _read_csv_text(raw)
    reader = csv.DictReader(io.StringIO(text))

    headers = reader.fieldnames
    if not headers:
        raise HTTPException(status_code=400, detail="Could not detect CSV columns")

    headers = list(headers)

    preview_rows: List[Dict[str, str]] = []
    for i, row in enumerate(reader):
        if i >= 5:
            break
        preview_rows.append({k: (v or "") for k, v in row.items()})

    suggested = _auto_detect_mapping(headers)

    return PreviewResponse(
        columns=headers,
        preview_rows=preview_rows,
        suggested_mapping=suggested,
    )


@router.post("/execute", response_model=ImportResult)
async def import_execute(
    file: UploadFile = File(...),
    column_mapping: str = Form(...),
    default_status: str = Form("new"),
    vacancy_id: Optional[int] = Form(None),
    skip_duplicates: bool = Form(True),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Import candidates from CSV using the provided column mapping."""

    # Resolve organisation
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(status_code=403, detail="Organization not found")

    # Parse mapping JSON
    try:
        mapping: Dict[str, str] = json.loads(column_mapping)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="column_mapping must be valid JSON")

    # Validate default status
    try:
        default_entity_status = EntityStatus(default_status)
    except ValueError:
        default_entity_status = EntityStatus.new

    # Read CSV
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="File is empty")

    text = _read_csv_text(raw)
    reader = csv.DictReader(io.StringIO(text))
    headers = reader.fieldnames or []

    # Invert mapping: entity_field -> csv_column
    field_to_csv: Dict[str, str] = {v: k for k, v in mapping.items()}

    # Pre-load existing emails for duplicate check
    existing_emails: set = set()
    if skip_duplicates and "email" in field_to_csv:
        result = await db.execute(
            select(Entity.email).where(
                Entity.org_id == org.id,
                Entity.email.isnot(None),
            )
        )
        existing_emails = {r[0].lower() for r in result.all() if r[0]}

    total = 0
    imported = 0
    skipped = 0
    errors: List[ImportErrorDetail] = []
    batch: List[Entity] = []
    vacancy_apps: List[VacancyApplication] = []

    mapped_fields = set(mapping.values())
    unmapped_csv_cols = [h for h in headers if h not in mapping]

    for row_num, row in enumerate(reader, start=2):  # row 1 = header
        total += 1
        try:
            # Extract mapped values
            name_val = (row.get(field_to_csv.get("name", ""), "") or "").strip()
            email_val = (row.get(field_to_csv.get("email", ""), "") or "").strip().lower()
            phone_val = (row.get(field_to_csv.get("phone", ""), "") or "").strip()
            position_val = (row.get(field_to_csv.get("position", ""), "") or "").strip()
            company_val = (row.get(field_to_csv.get("company", ""), "") or "").strip()
            status_val = (row.get(field_to_csv.get("status", ""), "") or "").strip()
            tags_val = (row.get(field_to_csv.get("tags", ""), "") or "").strip()
            telegram_val = (row.get(field_to_csv.get("telegram", ""), "") or "").strip()
            source_val = (row.get(field_to_csv.get("source", ""), "") or "").strip()
            comment_val = (row.get(field_to_csv.get("comment", ""), "") or "").strip()

            # Name is required
            if not name_val:
                errors.append(ImportErrorDetail(row=row_num, reason="Missing name"))
                continue

            # Duplicate check by email
            if skip_duplicates and email_val and email_val in existing_emails:
                skipped += 1
                continue

            # Build extra_data from unmapped columns + source/comment
            extra_data: Dict[str, Any] = {}
            for col in unmapped_csv_cols:
                val = (row.get(col, "") or "").strip()
                if val:
                    extra_data[col] = val
            if source_val:
                extra_data["source"] = source_val
            if comment_val:
                extra_data["comment"] = comment_val

            entity = Entity(
                org_id=org.id,
                type=EntityType.candidate,
                name=name_val,
                email=email_val or None,
                phone=phone_val or None,
                position=position_val or None,
                company=company_val or None,
                status=_parse_status(status_val, default_entity_status),
                tags=_parse_tags(tags_val) if tags_val else [],
                telegram_usernames=_normalize_telegram(telegram_val) if telegram_val else [],
                extra_data=extra_data if extra_data else {},
                created_by=current_user.id,
            )

            db.add(entity)
            batch.append(entity)

            # Track email for further duplicate detection within this import
            if email_val:
                existing_emails.add(email_val)

            imported += 1

            # Batch flush every 50 rows
            if len(batch) >= 50:
                await db.flush()
                if vacancy_id:
                    for e in batch:
                        vacancy_apps.append(VacancyApplication(
                            vacancy_id=vacancy_id,
                            entity_id=e.id,
                            stage=ApplicationStage.applied,
                            source="csv_import",
                            created_by=current_user.id,
                        ))
                batch.clear()

        except Exception as exc:
            errors.append(ImportErrorDetail(row=row_num, reason=str(exc)))

    # Flush remaining batch
    if batch:
        await db.flush()
        if vacancy_id:
            for e in batch:
                vacancy_apps.append(VacancyApplication(
                    vacancy_id=vacancy_id,
                    entity_id=e.id,
                    stage=ApplicationStage.applied,
                    source="csv_import",
                    created_by=current_user.id,
                ))
        batch.clear()

    # Add vacancy applications
    if vacancy_apps:
        db.add_all(vacancy_apps)

    await db.commit()

    return ImportResult(
        total=total,
        imported=imported,
        skipped=skipped,
        errors_count=len(errors),
        errors=errors,
    )


@router.get("/templates", response_model=List[TemplateMapping])
async def import_templates(
    current_user: User = Depends(get_current_user),
):
    """Return predefined column mapping templates for common CSV sources."""
    return [
        TemplateMapping(
            name="ClickUp",
            description="Standard ClickUp task export",
            mapping={
                "Name": "name",
                "Email": "email",
                "Phone": "phone",
                "Status": "status",
                "Tags": "tags",
                "Assignee": "comment",
            },
        ),
        TemplateMapping(
            name="HH.ru",
            description="HeadHunter resume search export",
            mapping={
                "ФИО": "name",
                "Электронная почта": "email",
                "Телефон": "phone",
                "Должность": "position",
                "Компания": "company",
                "Источник": "source",
            },
        ),
        TemplateMapping(
            name="Custom",
            description="Empty template — configure your own mapping",
            mapping={},
        ),
    ]
