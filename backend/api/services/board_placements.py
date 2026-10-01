"""Назначения на доске «Статусы»: разовый перенос старых данных.

До 30.09.2026 отдел человека лежал одним полем в карточке
(``entities.extra_data["board_department_id"]``), поэтому человек мог быть
ровно в одном отделе, а «перевод с практики в отдел» затирал песочницу. Теперь
отдел — это НАЗНАЧЕНИЕ (``staff_board_placements``): строк у человека столько,
в сколько отделов он поставлен, а карточка кандидата по-прежнему одна.

Этот модуль переносит уже заполненные отделы 1:1: кто стоял в отделе — получает
назначение в него, вместе со своими датами и отметками вех (они принадлежат
назначению: в песочнице это даты практики, в отделе — выход в отдел и вехи).
Практикантов, у которых отдел не выбран, ни в какую песочницу НЕ ставим — какая
у кого песочница, знает только HR (решение владельца 30.09.2026).
"""
import logging
from typing import Any, Dict, List

from sqlalchemy import select

from ..models.database import (
    BoardDepartment, BoardPlacement, DataMigrationMark, Entity,
)

logger = logging.getLogger("hr-analyzer.board-placements")

MIGRATION_MARK = "board_placements_from_extra_2026_09_30"

_K_BOARD_DEPT = "board_department_id"

# Что принадлежит назначению, а не человеку. Ключи те же, что на доске, плюс
# импортированные из ClickUp («cf:…»): их тоже забираем, иначе у перенесённых
# строк пропали бы даты, которые доска показывала из импорта.
PLACEMENT_KEYS = (
    "practice_start_date", "department_transfer_date",
    "w2_date", "m1_date", "m3_date", "y1_date",
    "department_start_done", "w2_done", "m1_done", "m3_done", "y1_done",
    "cf:Выход на практику", "cf:Выход в отдел",
    "cf:2 недели", "cf:3 мес", "cf:1 год",
)


def placement_extra(extra: Dict[str, Any]) -> Dict[str, Any]:
    """Даты и отметки, которые переезжают из карточки в назначение."""
    return {k: extra[k] for k in PLACEMENT_KEYS if extra.get(k) not in (None, "")}


# Песочницы на проде уже заведены обычными отделами (SANDBOX, SANDBOX MOBILE,
# SANDBOX R&D — Мария, 30.09.2026). Роль им проставляем по названию, иначе
# после выкатки HR пришлось бы открывать три окна и выбирать её руками.
SANDBOX_NAME_PREFIXES = ("sandbox", "сандбокс", "сэндбокс")


def looks_like_sandbox(name: str) -> bool:
    low = (name or "").strip().lower()
    return any(low.startswith(p) for p in SANDBOX_NAME_PREFIXES)


async def migrate_board_departments_once(db) -> int:
    """Перенести выбранные отделы из карточек в назначения. Один раз.

    Идемпотентно и без потерь: старые ключи в ``extra_data`` остаются на месте
    (их читают строки без назначений), дубликаты назначений не создаются.
    Коммитит. Возвращает число созданных назначений.
    """
    if await db.get(DataMigrationMark, MIGRATION_MARK) is not None:
        return 0

    depts = (await db.execute(select(BoardDepartment))).scalars().all()
    dept_orgs = {d.id: d.org_id for d in depts}
    for d in depts:
        if looks_like_sandbox(d.name) and (d.kind or "team") != "sandbox":
            d.kind = "sandbox"
            d.parent_id = None
            logger.info(f"BOARD_PLACEMENTS sandbox: «{d.name}» (id={d.id})")
    have = {
        (ent_id, dept_id) for ent_id, dept_id in (await db.execute(
            select(BoardPlacement.entity_id, BoardPlacement.department_id)
        )).all()
    }

    rows = (await db.execute(select(Entity.id, Entity.org_id, Entity.extra_data))).all()
    created: List[BoardPlacement] = []
    for ent_id, org_id, extra in rows:
        if not isinstance(extra, dict):
            continue
        raw = extra.get(_K_BOARD_DEPT)
        try:
            dept_id = int(raw)
        except (TypeError, ValueError):
            continue
        # Отдел удалён или из другой организации — молча пропускаем: строка
        # останется «без отдела», как и показывала доска.
        if dept_orgs.get(dept_id) != org_id or (ent_id, dept_id) in have:
            continue
        created.append(BoardPlacement(
            org_id=org_id, entity_id=ent_id, department_id=dept_id,
            extra=placement_extra(extra),
        ))
        have.add((ent_id, dept_id))

    for pl in created:
        db.add(pl)
    db.add(DataMigrationMark(key=MIGRATION_MARK))
    await db.commit()
    logger.info(f"BOARD_PLACEMENTS migrate: {len(created)} назначений из extra_data")
    return len(created)


# --- Практика ведёт в песочницу вакансии -------------------------------------

SANDBOX_KEY = "board_sandbox_id"   # Vacancy.extra_data


async def ensure_sandbox_placement(db, entity_id: int, vacancy) -> bool:
    """Поставить человека в песочницу вакансии, когда он вышел на практику.

    Какая у воронки песочница, HR задаёт в самой вакансии
    (``extra_data["board_sandbox_id"]``). Не задана — человек появляется на
    доске «без отдела», и песочницу ему выберут руками: угадывать нельзя, их
    несколько (решение владельца 30.09.2026).

    Ничего не делает, если человек уже стоит хоть в одном отделе: доска —
    не место для автоматических переездов. Не коммитит.
    """
    if vacancy is None:
        return False
    extra = vacancy.extra_data if isinstance(vacancy.extra_data, dict) else {}
    try:
        dept_id = int(extra.get(SANDBOX_KEY))
    except (TypeError, ValueError):
        return False

    dept = (await db.execute(
        select(BoardDepartment).where(
            BoardDepartment.id == dept_id, BoardDepartment.org_id == vacancy.org_id
        )
    )).scalar_one_or_none()
    if dept is None:
        return False

    already = (await db.execute(
        select(BoardPlacement.id).where(BoardPlacement.entity_id == entity_id).limit(1)
    )).scalar_one_or_none()
    if already is not None:
        return False

    db.add(BoardPlacement(
        org_id=vacancy.org_id, entity_id=entity_id, department_id=dept.id, extra={},
    ))
    logger.info(
        f"BOARD_PLACEMENT auto: entity {entity_id} → песочница «{dept.name}» "
        f"(вакансия {vacancy.id})"
    )
    return True
