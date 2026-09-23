"""Разовый снос неактуальных отделов (решение владельца, встреча 23.09.2026).

Мария: «тут всё неактуально, я буду с нуля полностью их создавать» — отделы на
проде остались от старой выгрузки, люди в них записаны неверно. Сносим ровно
пять отделов по именам; сотрудники не удаляются, у них просто пропадает отдел
(FK ON DELETE SET NULL), участники отдела снимаются (ON DELETE CASCADE).

Одноразово: отметка в ``data_migration_marks``. Иначе отдел с таким же именем,
заведённый Марией заново, сносило бы на каждом рестарте.
"""
import logging
from typing import Dict

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.database import DataMigrationMark, Department, Entity

logger = logging.getLogger("hr-analyzer.departments_reset")

# Ровно те отделы, что были на проде 23.09.2026. Сравнение без регистра и
# пробелов по краям; вложенных у них нет.
STALE_NAMES = ("asogp", "development", "hr отдел", "rnd отдел", "практика")
MARK = "departments_reset_2026_09_23"


async def reset_stale_departments_once(db: AsyncSession) -> Dict[str, int]:
    """Снести устаревшие отделы — один раз за всё время жизни базы."""
    if await db.get(DataMigrationMark, MARK) is not None:
        return {}

    rows = (await db.execute(select(Department.id, Department.name))).all()
    ids = [d_id for d_id, name in rows if (name or "").strip().lower() in STALE_NAMES]
    unassigned = 0
    if ids:
        unassigned = (await db.execute(
            select(func.count(Entity.id)).where(Entity.department_id.in_(ids))
        )).scalar_one()
        await db.execute(delete(Department).where(Department.id.in_(ids)))

    db.add(DataMigrationMark(key=MARK))
    await db.commit()
    result = {"departments_deleted": len(ids), "entities_unassigned": unassigned}
    if ids:
        logger.info("DEPARTMENTS_RESET: %s", result)
    return result
