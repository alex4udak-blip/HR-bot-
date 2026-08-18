"""Доска «Статусы» — жизненный цикл сотрудника внутри направления.

Строки доски — это КАРТОЧКИ КАНДИДАТОВ (Entity) в статусах жизненного цикла:
    probation   → Практика
    transferred → Перешёл в отдел
    dismissed   → Уволен
    quit        → Уволился

Папки-направления — собственный список организации (Organization.settings),
НЕ привязанный к отделам: их много и они меняются. У кандидата выбранное
направление лежит в Entity.extra_data["direction"].

Даты жизненного цикла тоже живут в Entity.extra_data. Ключи practice_start_date
и department_transfer_date переиспользованы намеренно — их уже пишет
PracticeListPage, так что уже введённые данные подхватятся, а не потеряются.

Вехи 1 мес / 3 мес / 1 год считаются от даты выхода в отдел; если HR вбил свою
дату вручную, она хранится в m1_date / m3_date / y1_date и имеет приоритет.

Доступ — org-scope (как смена этапа и загрузка файла в общем kanban): любой
сотрудник организации ведёт доску. Иначе HR ловил бы 403 на инлайн-правках.
"""
import logging
import uuid
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import String, cast, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlalchemy.orm.attributes import flag_modified

from ..database import get_db
from ..models.database import (
    Entity, EntityStatus, EntityFile, EntityFileType,
    Organization, User, Department,
)
from ..services.auth import get_current_user, get_user_org

logger = logging.getLogger("hr-analyzer.staff-board")

router = APIRouter()

# Статусы, попадающие на доску, в порядке отображения секций.
BOARD_STATUSES: List[EntityStatus] = [
    EntityStatus.probation,
    EntityStatus.transferred,
    EntityStatus.dismissed,
    EntityStatus.quit,
]

_SETTINGS_KEY = "staff_directions"

# Ключи в extra_data. practice_start_date / department_transfer_date —
# унаследованы от PracticeListPage, не переименовывать.
_K_DIRECTION = "direction"
_K_PRACTICE = "practice_start_date"
_K_DEPT_START = "department_transfer_date"
_K_MANAGER = "manager_name"
_K_W2 = "w2_date"
_K_M1 = "m1_date"
_K_M3 = "m3_date"
_K_Y1 = "y1_date"

# Автозаполнение из данных, импортированных из ClickUp. Импорт кладёт кастомные
# поля в extra_data как есть, с префиксом "cf:" — поэтому у уже залитых карточек
# даты/должность/руководитель зачастую УЖЕ есть, просто под другими ключами.
# Читаем их как запасной источник; при первой же ручной правке значение
# сохраняется в наш собственный ключ и дальше берётся оттуда.
_CF_PRACTICE = "cf:Выход на практику"
_CF_DEPT_START = "cf:Выход в отдел"
_CF_MANAGER = "cf:Рук-ль"
_CF_W2 = "cf:2 недели"
_CF_M3 = "cf:3 мес"
_CF_Y1 = "cf:1 год"
_CF_POSITION = "cf:Должность"
_CF_DEPARTMENT = "cf:Отдел"
_CF_TELEGRAM = "cf:Telegram"


# --------------------------------------------------------------------------- #
# Схемы                                                                         #
# --------------------------------------------------------------------------- #

class FolderCreate(BaseModel):
    name: str


class FolderUpdate(BaseModel):
    name: str


class Folder(BaseModel):
    id: str
    name: str


class BoardRow(BaseModel):
    entity_id: int
    name: str
    status: str
    direction: Optional[str] = None
    position: Optional[str] = None
    department_id: Optional[int] = None
    department_name: Optional[str] = None
    telegram: Optional[str] = None
    practice_start_date: Optional[str] = None
    department_start_date: Optional[str] = None
    manager: Optional[str] = None
    w2: Optional[str] = None
    m1: Optional[str] = None
    m3: Optional[str] = None
    y1: Optional[str] = None
    w2_auto: bool = True
    m1_auto: bool = True
    m3_auto: bool = True
    y1_auto: bool = True
    offer_file_id: Optional[int] = None
    offer_file_name: Optional[str] = None


class BoardRowUpdate(BaseModel):
    """Частичное обновление строки. Любое поле опционально.

    Разница между «не передали» и «очистили»: не переданное поле не трогаем,
    переданный null — очищаем.
    """
    status: Optional[str] = None
    direction: Optional[str] = None
    position: Optional[str] = None
    department_id: Optional[int] = None
    telegram: Optional[str] = None
    practice_start_date: Optional[str] = None
    department_start_date: Optional[str] = None
    manager: Optional[str] = None
    w2: Optional[str] = None
    m1: Optional[str] = None
    m3: Optional[str] = None
    y1: Optional[str] = None

    model_config = {"extra": "forbid"}


# --------------------------------------------------------------------------- #
# Хелперы                                                                       #
# --------------------------------------------------------------------------- #

def _add_months(d: date, months: int) -> date:
    """Дата + N месяцев с зажимом числа под длину месяца (31 янв +1 мес = 28/29 фев)."""
    total = d.month - 1 + months
    year = d.year + total // 12
    month = total % 12 + 1
    # последний день целевого месяца
    if month == 12:
        last = 31
    else:
        last = (date(year, month + 1, 1) - date.resolution).day
    return date(year, month, min(d.day, last))


def _parse_date(value: Any) -> Optional[date]:
    if not value:
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    try:
        return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return None


def _iso(d: Optional[date]) -> Optional[str]:
    return d.isoformat() if d else None


def _pick(ex: Dict[str, Any], *keys: str) -> Any:
    """Первое непустое значение по списку ключей (наш ключ → запасной из ClickUp)."""
    for k in keys:
        v = ex.get(k)
        if v not in (None, ""):
            return v
    return None


def _extra(entity: Entity) -> Dict[str, Any]:
    return entity.extra_data if isinstance(entity.extra_data, dict) else {}


def _get_folders(org: Organization) -> List[Dict[str, str]]:
    settings = org.settings if isinstance(org.settings, dict) else {}
    raw = settings.get(_SETTINGS_KEY) or []
    out: List[Dict[str, str]] = []
    for item in raw:
        if isinstance(item, dict) and item.get("id") and item.get("name"):
            out.append({"id": str(item["id"]), "name": str(item["name"])})
    return out


def _save_folders(org: Organization, folders: List[Dict[str, str]]) -> None:
    settings = dict(org.settings) if isinstance(org.settings, dict) else {}
    settings[_SETTINGS_KEY] = folders
    org.settings = settings
    flag_modified(org, "settings")


def _first_telegram(entity: Entity) -> Optional[str]:
    handles = entity.telegram_usernames
    if isinstance(handles, list) and handles:
        return str(handles[0]).lstrip("@")
    return None


def _row_from_entity(entity: Entity, offer: Optional[EntityFile]) -> BoardRow:
    ex = _extra(entity)
    dept_start = _parse_date(_pick(ex, _K_DEPT_START, _CF_DEPT_START))

    def milestone(key: str, cf_key: Optional[str], days: int = 0, months: int = 0):
        """Значение вехи + признак «посчитано автоматически».

        Приоритет: наш ключ → импортированное из ClickUp → авто-расчёт от даты
        выхода в отдел. Импортированное считаем ФАКТОМ (auto=False), а не
        расчётом: это реальная дата из старой системы.
        """
        manual = _parse_date(_pick(ex, key, cf_key) if cf_key else ex.get(key))
        if manual:
            return _iso(manual), False
        if dept_start:
            target = (dept_start + timedelta(days=days)) if days else _add_months(dept_start, months)
            return _iso(target), True
        return None, True

    w2, w2_auto = milestone(_K_W2, _CF_W2, days=14)
    m1, m1_auto = milestone(_K_M1, None, months=1)
    m3, m3_auto = milestone(_K_M3, _CF_M3, months=3)
    y1, y1_auto = milestone(_K_Y1, _CF_Y1, months=12)

    status = entity.status.value if hasattr(entity.status, "value") else str(entity.status)

    # Должность/отдел/telegram: своё поле карточки, иначе — импортированное.
    # «Отдел» из ClickUp — просто текст (связи с нашим справочником нет),
    # поэтому подставляем его только как подпись, department_id остаётся пустым.
    position = entity.position or _pick(ex, _CF_POSITION)
    dept_name = entity.department.name if entity.department else _pick(ex, _CF_DEPARTMENT)
    telegram = _first_telegram(entity) or (str(_pick(ex, _CF_TELEGRAM) or "").lstrip("@") or None)

    return BoardRow(
        entity_id=entity.id,
        name=entity.name,
        status=status,
        direction=ex.get(_K_DIRECTION) or None,
        position=position,
        department_id=entity.department_id,
        department_name=dept_name,
        telegram=telegram,
        practice_start_date=_iso(_parse_date(_pick(ex, _K_PRACTICE, _CF_PRACTICE))),
        department_start_date=_iso(dept_start),
        manager=_pick(ex, _K_MANAGER, _CF_MANAGER),
        w2=w2, m1=m1, m3=m3, y1=y1,
        w2_auto=w2_auto, m1_auto=m1_auto, m3_auto=m3_auto, y1_auto=y1_auto,
        offer_file_id=offer.id if offer else None,
        offer_file_name=offer.file_name if offer else None,
    )


# --------------------------------------------------------------------------- #
# Папки-направления                                                             #
# --------------------------------------------------------------------------- #

@router.get("/folders", response_model=List[Folder])
async def list_folders(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(403, "No organization access")
    return _get_folders(org)


@router.post("/folders", response_model=Folder, status_code=201)
async def create_folder(
    data: FolderCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(403, "No organization access")

    name = data.name.strip()
    if not name:
        raise HTTPException(400, "Название папки не может быть пустым")

    folders = _get_folders(org)
    if any(f["name"].lower() == name.lower() for f in folders):
        raise HTTPException(409, "Папка с таким названием уже есть")

    folder = {"id": uuid.uuid4().hex[:12], "name": name}
    folders.append(folder)
    _save_folders(org, folders)
    await db.commit()
    return folder


@router.patch("/folders/{folder_id}", response_model=Folder)
async def rename_folder(
    folder_id: str,
    data: FolderUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(403, "No organization access")

    name = data.name.strip()
    if not name:
        raise HTTPException(400, "Название папки не может быть пустым")

    folders = _get_folders(org)
    target = next((f for f in folders if f["id"] == folder_id), None)
    if not target:
        raise HTTPException(404, "Папка не найдена")

    target["name"] = name
    _save_folders(org, folders)
    await db.commit()
    return target


@router.delete("/folders/{folder_id}")
async def delete_folder(
    folder_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Удаляет папку. Кандидаты не удаляются — они уходят в «Без направления»."""
    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(403, "No organization access")

    folders = _get_folders(org)
    rest = [f for f in folders if f["id"] != folder_id]
    if len(rest) == len(folders):
        raise HTTPException(404, "Папка не найдена")

    _save_folders(org, rest)

    # Снимаем направление у карточек этой папки. Тянем только id + extra_data
    # (а не ORM-объекты Entity целиком) — карточек в организации тысячи, полная
    # загрузка ради редкого действия «удалить папку» была бы неоправданной.
    rows = (await db.execute(
        select(Entity.id, Entity.extra_data).where(Entity.org_id == org.id)
    )).all()
    victim_ids = [
        ent_id for ent_id, extra in rows
        if isinstance(extra, dict) and extra.get(_K_DIRECTION) == folder_id
    ]

    cleared = 0
    if victim_ids:
        entities = (await db.execute(
            select(Entity).where(Entity.id.in_(victim_ids))
        )).scalars().all()
        for ent in entities:
            ex = dict(_extra(ent))
            ex.pop(_K_DIRECTION, None)
            ent.extra_data = ex
            flag_modified(ent, "extra_data")
            cleared += 1

    await db.commit()
    return {"success": True, "cleared": cleared}


# --------------------------------------------------------------------------- #
# Строки доски                                                                  #
# --------------------------------------------------------------------------- #

@router.get("/positions", response_model=List[str])
async def list_positions(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Справочник должностей организации — уже встречающиеся значения.

    Живёт здесь, потому что это org-scoped справочник HR-раздела: его берут и
    доска, и диалог «Взять в штат» (подсказки в поле «Должность»). Отдельной
    таблицы должностей в системе нет, поэтому собираем distinct по карточкам.
    """
    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(403, "No organization access")

    rows = (await db.execute(
        select(Entity.position)
        .where(
            Entity.org_id == org.id,
            Entity.position.is_not(None),
            Entity.position != "",
        )
        .distinct()
    )).scalars().all()

    seen: Dict[str, str] = {}
    for value in rows:
        clean = (value or "").strip()
        if clean and clean.lower() not in seen:
            seen[clean.lower()] = clean
    return sorted(seen.values(), key=str.lower)


@router.get("/rows", response_model=List[BoardRow])
async def list_rows(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Все карточки организации в статусах жизненного цикла."""
    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(403, "No organization access")

    # Статус сравниваем как ТЕКСТ, а не как enum: если значения dismissed/quit
    # ещё не доехали в pg-enum (ALTER TYPE в start.sh не отработал), обычный
    # IN по enum-у уронил бы весь запрос. С cast доска грузится всегда.
    entities = (await db.execute(
        select(Entity)
        .where(
            Entity.org_id == org.id,
            cast(Entity.status, String).in_([s.value for s in BOARD_STATUSES]),
            Entity.is_archived.is_not(True),
        )
        .options(selectinload(Entity.department))
        .order_by(Entity.name)
    )).scalars().all()

    if not entities:
        return []

    # Файлы оффера одним запросом (последний загруженный на карточку)
    ids = [e.id for e in entities]
    offer_rows = (await db.execute(
        select(EntityFile.id, EntityFile.entity_id, EntityFile.file_name)
        .where(
            EntityFile.entity_id.in_(ids),
            # как текст — чтобы запрос не падал, пока значение 'offer'
            # не добавлено в pg-enum (см. start.sh)
            cast(EntityFile.file_type, String) == EntityFileType.offer.value,
        )
        .order_by(EntityFile.id.desc())
    )).all()
    offers: Dict[int, Any] = {}
    for f_id, ent_id, f_name in offer_rows:
        offers.setdefault(ent_id, type("F", (), {"id": f_id, "file_name": f_name})())

    return [_row_from_entity(e, offers.get(e.id)) for e in entities]


@router.patch("/rows/{entity_id}", response_model=BoardRow)
async def update_row(
    entity_id: int,
    data: BoardRowUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Инлайн-правка строки доски. Org-scope: доску ведёт любой в организации."""
    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)
    if not org:
        raise HTTPException(403, "No organization access")

    entity = (await db.execute(
        select(Entity)
        .where(Entity.id == entity_id, Entity.org_id == org.id)
        .options(selectinload(Entity.department))
    )).scalar_one_or_none()
    if not entity:
        raise HTTPException(404, "Кандидат не найден")

    payload = data.model_dump(exclude_unset=True)

    # --- Поля самой карточки ---
    if "status" in payload:
        raw = payload["status"]
        try:
            new_status = EntityStatus(raw)
        except ValueError:
            raise HTTPException(400, f"Неизвестный статус: {raw}")
        entity.status = new_status

    if "position" in payload:
        entity.position = (payload["position"] or None)

    if "department_id" in payload:
        dept_id = payload["department_id"]
        if dept_id is not None:
            dept = (await db.execute(
                select(Department).where(
                    Department.id == dept_id, Department.org_id == org.id
                )
            )).scalar_one_or_none()
            if not dept:
                raise HTTPException(404, "Отдел не найден")
        entity.department_id = dept_id

    if "telegram" in payload:
        handle = (payload["telegram"] or "").strip().lstrip("@")
        entity.telegram_usernames = [handle] if handle else []

    # --- Поля доски в extra_data ---
    extra_map = {
        "direction": _K_DIRECTION,
        "practice_start_date": _K_PRACTICE,
        "department_start_date": _K_DEPT_START,
        "manager": _K_MANAGER,
        "w2": _K_W2,
        "m1": _K_M1,
        "m3": _K_M3,
        "y1": _K_Y1,
    }
    touched_extra = False
    ex = dict(_extra(entity))
    for field, key in extra_map.items():
        if field not in payload:
            continue
        value = payload[field]
        if value in (None, ""):
            ex.pop(key, None)
        else:
            # даты нормализуем к YYYY-MM-DD
            if key in (_K_PRACTICE, _K_DEPT_START, _K_W2, _K_M1, _K_M3, _K_Y1):
                parsed = _parse_date(value)
                if not parsed:
                    raise HTTPException(400, f"Некорректная дата в поле {field}")
                ex[key] = parsed.isoformat()
            else:
                ex[key] = str(value).strip()
        touched_extra = True

    if touched_extra:
        entity.extra_data = ex
        flag_modified(entity, "extra_data")

    await db.commit()

    # НЕ db.refresh(): он сбрасывает уже загруженную связь department, и
    # следующее обращение к entity.department.name ушло бы в ленивую подгрузку —
    # в async-сессии это падает (MissingGreenlet). Перечитываем явно с selectinload.
    entity = (await db.execute(
        select(Entity)
        .where(Entity.id == entity_id)
        .options(selectinload(Entity.department))
    )).scalar_one()

    offer = (await db.execute(
        select(EntityFile)
        .where(
            EntityFile.entity_id == entity.id,
            cast(EntityFile.file_type, String) == EntityFileType.offer.value,
        )
        .order_by(EntityFile.id.desc())
        .limit(1)
    )).scalar_one_or_none()

    logger.info(f"Board row updated: entity {entity_id} by user {current_user.id}")
    return _row_from_entity(entity, offer)
