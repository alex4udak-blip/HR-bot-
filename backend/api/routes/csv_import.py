"""
API routes for CSV import of candidates (ClickUp, HH.ru, etc.).
"""
import csv
import io
import json
import logging
import re
from datetime import date
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
    "phone": ["phone", "телефон", "тел", "тел.", "mobile", "мобильный", "контактный номер", "контактный телефон", "номер телефона"],
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

# Mapping targets that become first-class DB columns or dedicated extra_data keys.
# Any CSV column NOT mapped to one of these is preserved into extra_data verbatim.
_FIRST_CLASS_FIELDS = {
    "name", "email", "phone", "position", "company",
    "status", "tags", "telegram", "source", "comment",
}


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
    headers: List[str]
    rows: List[List[str]]  # Array of arrays (each row = list of cell values in header order)
    suggested_mapping: Dict[str, str]  # csv_column -> entity_field
    row_count: int


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
        # ClickUp custom-field columns are prefixed "cf:" — match on the bare name
        if normalized.startswith("cf:"):
            normalized = normalized[3:].strip()
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


def _normalize_phone(value: str) -> str:
    """Reduce a phone number to comparable digits (last 10) for dedup."""
    if not value:
        return ""
    digits = re.sub(r"\D", "", value)
    return digits[-10:] if len(digits) >= 10 else digits


_BIRTHDATE_RE = re.compile(r"Дата рождения:\s*(\d{4}-\d{2}-\d{2})T")


def _extract_clickup_birthdate(description: str) -> Optional[str]:
    """Birth date as a local calendar date (YYYY-MM-DD).

    ClickUp's custom-field column stores the value in UTC, which can shift the
    date by a day. The task description keeps the original timezone-aware ISO
    value, so we take the date part (before 'T') from there instead.
    """
    if not description:
        return None
    m = _BIRTHDATE_RE.search(description)
    if not m:
        return None
    value = m.group(1)
    year = int(value[:4])
    # Guard against junk values (form-submission dates, test entries)
    if year < 1940 or year > date.today().year - 14:
        return None
    return value


def _extract_clickup_location(raw: str) -> Optional[str]:
    """Readable address from ClickUp's location custom field (a geo-JSON blob)."""
    if not raw:
        return None
    try:
        data = json.loads(raw)
        addr = data.get("formatted_address")
        return addr or None
    except (json.JSONDecodeError, AttributeError, TypeError):
        return None


def _clickup_postprocess(extra_data: Dict[str, Any], row: Dict[str, str]) -> None:
    """Normalize ClickUp-specific fields inside extra_data (in place)."""
    # Birth date: local calendar date from the description ISO (not the UTC column)
    bd = _extract_clickup_birthdate(row.get("description", ""))
    if bd:
        extra_data["birth_date"] = bd
    extra_data.pop("cf:Дата рождения", None)  # raw UTC value, can be off by a day

    # Location: readable address instead of the raw lat/lng JSON
    loc = _extract_clickup_location(row.get("cf:Местонахождение", ""))
    if loc:
        extra_data["location"] = loc
    extra_data.pop("cf:Местонахождение", None)

    # Preserve the original ClickUp pipeline status verbatim
    st = (row.get("status", "") or "").strip()
    if st:
        extra_data["clickup_status"] = st
    extra_data.pop("status", None)
    extra_data.pop("status_type", None)

    # Rename ClickUp identifiers for clarity
    tid = (row.get("task_id", "") or "").strip()
    if tid:
        extra_data["clickup_task_id"] = tid
    extra_data.pop("task_id", None)
    link = (row.get("url", "") or "").strip()
    if link:
        extra_data["clickup_url"] = link
    extra_data.pop("url", None)

    extra_data["import_source"] = "clickup"


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

    # Collect first 5 rows as arrays (in header order) for the preview table
    preview_rows: List[List[str]] = []
    for i, row in enumerate(reader):
        if i >= 5:
            break
        preview_rows.append([row.get(h, "") or "" for h in headers])

    suggested = _auto_detect_mapping(headers)

    return PreviewResponse(
        headers=headers,
        rows=preview_rows,
        suggested_mapping=suggested,
        row_count=len(list(csv.DictReader(io.StringIO(text)))),
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

    # Detect a ClickUp export by its signature columns
    is_clickup = "task_id" in headers and any(h.startswith("funnel_") for h in headers)
    if is_clickup and default_status == "new":
        # Imported ClickUp candidates are historical/archival
        default_entity_status = EntityStatus.reserve

    # Pre-load existing identifiers for duplicate check (email / phone / telegram)
    existing_emails: set = set()
    existing_phones: set = set()
    existing_telegrams: set = set()
    if skip_duplicates:
        result = await db.execute(
            select(
                Entity.email, Entity.phone, Entity.phones, Entity.telegram_usernames
            ).where(Entity.org_id == org.id)
        )
        for email_r, phone_r, phones_r, tg_r in result.all():
            if email_r:
                existing_emails.add(email_r.lower())
            for p in ([phone_r] if phone_r else []) + (phones_r or []):
                pn = _normalize_phone(p)
                if pn:
                    existing_phones.add(pn)
            for t in (tg_r or []):
                existing_telegrams.add(str(t).lower().lstrip("@"))

    total = 0
    imported = 0
    skipped = 0
    errors: List[ImportErrorDetail] = []
    batch: List[Entity] = []
    vacancy_apps: List[VacancyApplication] = []

    for row_num, row in enumerate(reader, start=2):  # row 1 = header
        total += 1
        try:
            # Extract mapped first-class values
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

            # ClickUp: applied vacancy lives in the funnel list name
            if is_clickup and not position_val:
                position_val = (row.get("funnel_list", "") or "").strip()

            # Name is required
            if not name_val:
                errors.append(ImportErrorDetail(row=row_num, reason="Missing name"))
                continue

            # Normalize identifiers for dedup
            tg_list = _normalize_telegram(telegram_val) if telegram_val else []
            phone_norm = _normalize_phone(phone_val)

            # Duplicate check by email / phone / telegram
            if skip_duplicates and (
                (email_val and email_val in existing_emails)
                or (phone_norm and phone_norm in existing_phones)
                or any(t in existing_telegrams for t in tg_list)
            ):
                skipped += 1
                continue

            # Preserve every column not used as a first-class field into extra_data
            extra_data: Dict[str, Any] = {}
            for col in headers:
                if mapping.get(col, "") in _FIRST_CLASS_FIELDS:
                    continue
                val = (row.get(col, "") or "").strip()
                if val:
                    extra_data[col] = val
            if source_val:
                extra_data["source"] = source_val
            if comment_val:
                extra_data["comment"] = comment_val

            # Status + ClickUp normalization
            if is_clickup:
                _clickup_postprocess(extra_data, row)
                status_for_row = default_entity_status  # archival; original kept in extra_data
            else:
                status_for_row = _parse_status(status_val, default_entity_status)

            entity = Entity(
                org_id=org.id,
                type=EntityType.candidate,
                name=name_val,
                email=email_val or None,
                phone=phone_val or None,
                phones=[phone_val] if phone_val else [],
                position=position_val or None,
                company=company_val or None,
                status=status_for_row,
                tags=_parse_tags(tags_val) if tags_val else [],
                telegram_usernames=tg_list,
                extra_data=extra_data if extra_data else {},
                created_by=current_user.id,
            )

            db.add(entity)
            batch.append(entity)

            # Track identifiers to dedup within this import too
            if email_val:
                existing_emails.add(email_val)
            if phone_norm:
                existing_phones.add(phone_norm)
            for t in tg_list:
                existing_telegrams.add(t)

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
