"""Корзина кандидатов: слепок перед удалением и возврат как был (20.10.2026).

Случай 19.10.2026: кандидатку удалили, и ни кто, ни когда — не записалось, а
вернуть было нечем. Удаление стирает кандидата каскадом вместе с заявками,
историей этапов, файлами, метками, назначениями на доске «Штат» и т.д.; у чатов,
звонков и ответов анкет ссылка на кандидата просто обнуляется.

Поэтому перед удалением снимаем СЛЕПОК: строку кандидата и все строки, которые
каскад сотрёт (обходим внешние ключи по моделям — новая таблица со ссылкой на
кандидата попадёт в слепок сама), плюс список обнулённых ссылок. Возврат
вставляет строки обратно с теми же номерами (родители раньше детей) и
восстанавливает обнулённые ссылки. Всё в одной транзакции: не вышло — не
вернули ничего, кандидат остаётся в корзине, причина — в ответе.
"""
from __future__ import annotations

import base64
import enum
import logging
import uuid
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import and_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.database import Base, DeletedEntity, Entity, User

logger = logging.getLogger("hr-analyzer.entity_trash")

TRASH_DAYS = 7
ROOT_TABLE = "entities"


# --- значения колонок ⇄ JSON ---------------------------------------------------

def _encode(value: Any) -> Any:
    if isinstance(value, datetime):
        return {"__dt": value.isoformat()}
    if isinstance(value, date):
        return {"__d": value.isoformat()}
    if isinstance(value, Decimal):
        return {"__dec": str(value)}
    if isinstance(value, (bytes, bytearray, memoryview)):
        return {"__b": base64.b64encode(bytes(value)).decode()}
    if isinstance(value, enum.Enum):
        return value.value
    if isinstance(value, uuid.UUID):
        return str(value)
    return value


def _decode(column, value: Any) -> Any:
    if isinstance(value, dict) and len(value) == 1:
        (tag, raw), = value.items()
        if tag == "__dt":
            return datetime.fromisoformat(raw)
        if tag == "__d":
            return date.fromisoformat(raw)
        if tag == "__dec":
            return Decimal(raw)
        if tag == "__b":
            return base64.b64decode(raw)
    enum_class = getattr(column.type, "enum_class", None)
    if enum_class is not None and isinstance(value, str):
        try:
            return enum_class(value)
        except ValueError:
            return enum_class[value]
    return value


# --- граф ссылок на кандидата ---------------------------------------------------

def _children(table_name: str) -> List[Tuple[Any, Any, Any, Optional[str]]]:
    """(дочерняя таблица, её колонка, колонка родителя, ondelete) для table_name."""
    out = []
    for t in Base.metadata.sorted_tables:
        for fk in t.foreign_keys:
            if fk.column.table.name == table_name:
                out.append((t, fk.parent, fk.column, (fk.ondelete or "").upper() or None))
    return out


def _pk(table, row: dict) -> tuple:
    cols = [c.name for c in table.primary_key.columns] or [c.name for c in table.columns]
    return tuple(row.get(c) for c in cols)


async def snapshot_entity(db: AsyncSession, entity_id: int) -> Dict[str, Any]:
    """Всё, что удаление кандидата сотрёт или отвяжет. Ничего не пишет."""
    md = Base.metadata
    rows: Dict[str, Dict[tuple, dict]] = {}
    links: List[dict] = []

    async def fetch(table, where) -> List[dict]:
        res = await db.execute(select(table).where(where))
        return [dict(r._mapping) for r in res]

    root = md.tables[ROOT_TABLE]
    found = await fetch(root, root.c.id == entity_id)
    if not found:
        raise LookupError(f"entity {entity_id} not found")
    rows[ROOT_TABLE] = {_pk(root, r): r for r in found}

    queue = [ROOT_TABLE]
    while queue:
        parent_name = queue.pop(0)
        parent_rows = list(rows.get(parent_name, {}).values())
        for child, col, ref_col, ondelete in _children(parent_name):
            values = sorted({r[ref_col.name] for r in parent_rows if r.get(ref_col.name) is not None})
            if not values:
                continue
            got = await fetch(child, col.in_(values))
            if not got:
                continue
            if ondelete == "CASCADE":
                bucket = rows.setdefault(child.name, {})
                new = False
                for r in got:
                    key = _pk(child, r)
                    if key not in bucket:
                        bucket[key] = r
                        new = True
                if new:
                    queue.append(child.name)
            elif ondelete == "SET NULL":
                pk_cols = [c.name for c in child.primary_key.columns]
                for r in got:
                    links.append({
                        "table": child.name,
                        "pk": {c: _encode(r[c]) for c in pk_cols},
                        "column": col.name,
                        "value": _encode(r[col.name]),
                    })
    return {
        "version": 1,
        "tables": {
            name: [{k: _encode(v) for k, v in r.items()} for r in bucket.values()]
            for name, bucket in rows.items()
        },
        "links": links,
    }


async def move_to_trash(
    db: AsyncSession, entity: Entity, user: User, *, now: Optional[datetime] = None,
) -> DeletedEntity:
    """Снять слепок и записать в журнал. Само удаление делает вызывающий."""
    now = now or datetime.utcnow()
    snap = await snapshot_entity(db, entity.id)
    record = DeletedEntity(
        org_id=entity.org_id,
        entity_id=entity.id,
        entity_name=entity.name,
        entity_type=entity.type.value if hasattr(entity.type, "value") else entity.type,
        deleted_by_id=user.id,
        deleted_by_name=user.name,
        deleted_at=now,
        purge_after=now + timedelta(days=TRASH_DAYS),
        snapshot=snap,
    )
    db.add(record)
    return record


class RestoreError(Exception):
    """Вернуть нельзя — текст для человека."""


async def restore_from_trash(db: AsyncSession, record: DeletedEntity, user: User) -> Dict[str, int]:
    """Вставить слепок обратно. Не коммитит.

    Сам кандидат возвращается обязательно (не вышло — RestoreError, ничего не
    меняем). Связанные строки — каждая отдельно: если за неделю удалили, скажем,
    воронку или второго кандидата из пары «Разные люди», эта строка не вернётся,
    а остальное — вернётся. Возвращает {таблица: сколько строк не вернулось}.
    """
    if record.restored_at is not None:
        raise RestoreError("Кандидат уже возвращён")
    if not record.snapshot:
        raise RestoreError("Срок хранения в корзине истёк — вернуть уже нельзя")
    exists = (await db.execute(select(Entity.id).where(Entity.id == record.entity_id))).scalar()
    if exists:
        raise RestoreError("Карточка с этим номером уже есть")

    md = Base.metadata
    tables = record.snapshot.get("tables") or {}

    def _values(table, raw: dict) -> dict:
        return {k: _decode(table.c[k], v) for k, v in raw.items() if k in table.c}

    root = md.tables[ROOT_TABLE]
    try:
        async with db.begin_nested():
            for raw in tables.get(ROOT_TABLE) or []:
                await db.execute(root.insert().values(**_values(root, raw)))
    except Exception as e:  # noqa: BLE001
        logger.warning("ENTITY_RESTORE failed: record=%s entity=%s: %s", record.id, record.entity_id, e)
        raise RestoreError("Не удалось вернуть карточку — подробности в логе ENTITY_RESTORE") from e

    skipped: Dict[str, int] = {}
    for table in md.sorted_tables:  # родители раньше детей
        if table.name == ROOT_TABLE:
            continue
        for raw in tables.get(table.name) or []:
            try:
                async with db.begin_nested():
                    await db.execute(table.insert().values(**_values(table, raw)))
            except Exception as e:  # noqa: BLE001
                skipped[table.name] = skipped.get(table.name, 0) + 1
                logger.info("ENTITY_RESTORE skip %s: %s", table.name, str(e)[:200])

    for link in record.snapshot.get("links") or []:
        table = md.tables.get(link["table"])
        if table is None or link["column"] not in table.c:
            continue
        col = table.c[link["column"]]
        cond = [table.c[k] == _decode(table.c[k], v) for k, v in link["pk"].items() if k in table.c]
        # Только если ссылку за это время никто не поставил заново.
        await db.execute(
            update(table)
            .where(and_(*cond), col.is_(None))
            .values({col.name: _decode(col, link["value"])})
        )

    record.restored_at = datetime.utcnow()
    record.restored_by_id = user.id
    record.restored_by_name = user.name
    return skipped


async def purge_expired(db: AsyncSession, *, now: Optional[datetime] = None) -> int:
    """Стереть слепки старше срока. Строка журнала остаётся. Не коммитит."""
    now = now or datetime.utcnow()
    res = await db.execute(
        update(DeletedEntity)
        .where(
            DeletedEntity.purge_after < now,
            DeletedEntity.purged_at.is_(None),
            DeletedEntity.restored_at.is_(None),
        )
        .values(snapshot=None, purged_at=now)
    )
    return res.rowcount or 0


def snapshot_summary(snapshot: Optional[dict]) -> Dict[str, Any]:
    """Что в слепке — для списка корзины: сколько воронок, файлов, записей истории."""
    if not snapshot:
        return {}
    t = snapshot.get("tables") or {}
    return {
        "applications": len(t.get("vacancy_applications") or []),
        "history": len(t.get("stage_transitions") or []),
        "files": len(t.get("entity_files") or []),
    }
