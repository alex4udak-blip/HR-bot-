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
    "на рассмотрении": EntityStatus.screening,
    "рассмотрение": EntityStatus.screening,
    "интервью": EntityStatus.is_interview,
    "резерв": EntityStatus.reserve,
    "отозван": EntityStatus.withdrawn,
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


class SkippedRowDetail(BaseModel):
    row: int
    name: str
    reason: str  # напр. «Дубликат по email: Иванов Иван»


class ImportResult(BaseModel):
    total: int
    imported: int
    skipped: int
    skipped_details: List[SkippedRowDetail] = []
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

    # Invert mapping: entity_field -> [csv_column, ...]
    # Несколько CSV-колонок могут мапиться на одно поле (напр. родная `name`
    # и кастомное `cf:ФИО`). Раньше инверсия {v:k} молча оставляла последнюю
    # колонку — и почти пустое кастомное поле перебивало настоящее имя, давая
    # массовый «Missing name». Теперь храним ВСЕ колонки поля (в порядке заголовка)
    # и на каждой строке берём первое непустое значение.
    field_to_csvs: Dict[str, List[str]] = {}
    for csv_col, field in mapping.items():
        if not field:
            continue
        field_to_csvs.setdefault(field, []).append(csv_col)
    for field, cols in field_to_csvs.items():
        cols.sort(key=lambda c: headers.index(c) if c in headers else len(headers))

    def pick(field: str, row: Dict[str, str]) -> str:
        for col in field_to_csvs.get(field, []):
            val = (row.get(col, "") or "").strip()
            if val:
                return val
        return ""

    # Detect a ClickUp export by its signature columns
    is_clickup = "task_id" in headers and any(h.startswith("funnel_") for h in headers)
    if is_clickup and default_status == "new":
        # Imported ClickUp candidates are historical/archival
        default_entity_status = EntityStatus.reserve

    # Pre-load existing identifiers for duplicate check (email / phone / telegram).
    # Значение -> имя существующего кандидата (не только само совпадение), чтобы
    # в отчёте показать НА КОГО именно похожа пропущенная строка — иначе «503
    # пропущено» ничего не объясняет пользователю.
    existing_emails: Dict[str, str] = {}
    existing_phones: Dict[str, str] = {}
    existing_telegrams: Dict[str, str] = {}
    if skip_duplicates:
        result = await db.execute(
            select(
                Entity.email, Entity.phone, Entity.phones, Entity.telegram_usernames, Entity.name
            ).where(Entity.org_id == org.id)
        )
        for email_r, phone_r, phones_r, tg_r, name_r in result.all():
            if email_r:
                existing_emails.setdefault(email_r.lower(), name_r or "")
            for p in ([phone_r] if phone_r else []) + (phones_r or []):
                pn = _normalize_phone(p)
                if pn:
                    existing_phones.setdefault(pn, name_r or "")
            for t in (tg_r or []):
                existing_telegrams.setdefault(str(t).lower().lstrip("@"), name_r or "")

    total = 0
    imported = 0
    skipped = 0
    skipped_details: List[SkippedRowDetail] = []
    errors: List[ImportErrorDetail] = []
    batch: List[Entity] = []
    vacancy_apps: List[VacancyApplication] = []

    # ── ClickUp combine: одна карточка на человека со всеми прохождениями ──
    # Один человек лежит в нескольких строках (разные вакансии/рекрутёры/анкеты).
    # Группируем по сильному ключу (hh/email/телефон), собираем участия в
    # extra_data.participations и создаём ОДНУ архивную карточку на человека.
    # Идемпотентно: совпал с уже существующей архивной карточкой → до-кладываем
    # недостающие участия, новую не плодим.
    if is_clickup:
        from ..services.clickup_import import (
            row_strong_keys as _cu_keys,
            group_rows_by_person as _cu_group,
            assemble_person as _cu_assemble,
            extract_hh_from_row as _cu_hh,
            extract_email_from_row as _cu_email,
            merge_participations as _cu_merge,
        )
        cf_headers = [h for h in headers if h.lower().startswith("cf:")]

        def _norm(r: Dict[str, str]) -> Dict[str, str]:
            # ClickUp хранит контакты в cf:-колонках с произвольными именами.
            # Нормализуем name/email/phone/telegram, СОХРАНЯЯ raw funnel_*/cf: колонки
            # (нужны build_participation и hh/email-экстракторам).
            out = dict(r)
            out["name"] = pick("name", r)
            out["email"] = pick("email", r) or (_cu_email(r) or "")
            out["phone"] = pick("phone", r)
            out["telegram"] = pick("telegram", r)
            return out

        all_rows = [_norm(r) for r in reader]
        total = len(all_rows)

        def _key_fn(r: Dict[str, str]) -> set:
            return _cu_keys(r.get("email", ""), r.get("phone", ""), _cu_hh(r))

        # Индекс существующего архива: сильный-ключ → Entity (для идемпотентности).
        existing_res = await db.execute(
            select(Entity).where(Entity.org_id == org.id, Entity.is_archived.is_(True))
        )
        key_index: Dict[str, Entity] = {}
        task_index: Dict[str, Entity] = {}
        for ent in existing_res.scalars().all():
            ident = _cu_keys(ent.email or "", ent.phone or "", None)
            for ph in (ent.phones or []):
                ident |= _cu_keys("", ph, None)
            for k in ident:
                key_index.setdefault(k, ent)
            for tid in ((ent.extra_data or {}).get("clickup_task_ids") or []):
                if tid:
                    task_index.setdefault(tid, ent)

        for group in _cu_group(all_rows, _key_fn):
            try:
                payload = _cu_assemble(group, cf_headers)
                if not payload["name"]:
                    errors.append(ImportErrorDetail(row=0, reason="Missing name"))
                    continue
                group_keys: set = set()
                for r in group:
                    group_keys |= _key_fn(r)
                group_task_ids = {
                    (r.get("task_id") or "").strip()
                    for r in group
                    if (r.get("task_id") or "").strip()
                }
                # Матч с существующим: сначала по сильному ключу, затем по task_id
                # (последнее ловит людей без телефона/почты — только hh или только ФИО,
                # которые иначе дублировались бы при каждом переимпорте).
                match = next((key_index[k] for k in group_keys if k in key_index), None)
                if match is None:
                    match = next((task_index[t] for t in group_task_ids if t in task_index), None)
                if match is not None:
                    # Идемпотентно до-кладываем участия в существующую карточку.
                    ed = dict(match.extra_data or {})
                    ed["participations"] = _cu_merge(
                        ed.get("participations", []),
                        payload["extra_data"]["participations"],
                    )
                    ed["clickup_task_ids"] = sorted(
                        set(ed.get("clickup_task_ids") or []) | group_task_ids
                    )
                    match.extra_data = ed
                    for k in group_keys:
                        key_index.setdefault(k, match)
                    for t in group_task_ids:
                        task_index.setdefault(t, match)
                    skipped += 1
                    continue
                entity = Entity(
                    org_id=org.id,
                    type=EntityType.candidate,
                    name=payload["name"],
                    email=payload["email"],
                    phone=payload["phone"],
                    phones=payload["phones"],
                    position=payload["position"],
                    status=EntityStatus.reserve,
                    telegram_usernames=payload["telegram_usernames"],
                    extra_data=payload["extra_data"],
                    created_by=current_user.id,
                    is_archived=True,
                )
                db.add(entity)
                for k in group_keys:
                    key_index[k] = entity
                for t in group_task_ids:
                    task_index[t] = entity
                imported += 1
            except Exception as exc:  # noqa: BLE001
                errors.append(ImportErrorDetail(row=0, reason=str(exc)))
        await db.commit()
        return ImportResult(
            total=total, imported=imported, skipped=skipped,
            skipped_details=skipped_details, errors_count=len(errors), errors=errors,
        )
    # ── /ClickUp combine ── (ниже — прежний построчный путь для не-ClickUp CSV)

    for row_num, row in enumerate(reader, start=2):  # row 1 = header
        total += 1
        try:
            # Extract mapped first-class values (first non-empty column per field)
            name_val = pick("name", row)
            email_val = pick("email", row).lower()
            phone_val = pick("phone", row)
            position_val = pick("position", row)
            company_val = pick("company", row)
            status_val = pick("status", row)
            tags_val = pick("tags", row)
            telegram_val = pick("telegram", row)
            source_val = pick("source", row)
            comment_val = pick("comment", row)

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

            # Duplicate check by email / phone / telegram — какое ИМЕННО поле
            # совпало и с кем, попадает в skipped_details (иначе непонятно,
            # почему строка пропущена и на кого она похожа).
            if skip_duplicates:
                matched_name = None
                matched_reason = None
                if email_val and email_val in existing_emails:
                    matched_name = existing_emails[email_val]
                    matched_reason = "email"
                elif phone_norm and phone_norm in existing_phones:
                    matched_name = existing_phones[phone_norm]
                    matched_reason = "телефону"
                else:
                    for t in tg_list:
                        if t in existing_telegrams:
                            matched_name = existing_telegrams[t]
                            matched_reason = "Telegram"
                            break
                if matched_reason:
                    skipped += 1
                    skipped_details.append(SkippedRowDetail(
                        row=row_num,
                        name=name_val,
                        reason=f"Дубликат по {matched_reason}"
                        + (f": {matched_name}" if matched_name else ""),
                    ))
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
                if status_val:
                    # Исходную метку статуса из CSV сохраняем как есть — не теряем её,
                    # даже если она не легла в EntityStatus (кандидат уходит в архив).
                    extra_data["import_status"] = status_val

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
                is_archived=True,  # bulk CSV-импорт → теневая база (архив)
            )

            db.add(entity)
            batch.append(entity)

            # Track identifiers to dedup within this import too
            if email_val:
                existing_emails.setdefault(email_val, name_val)
            if phone_norm:
                existing_phones.setdefault(phone_norm, name_val)
            for t in tg_list:
                existing_telegrams.setdefault(t, name_val)

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
        skipped_details=skipped_details,
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
