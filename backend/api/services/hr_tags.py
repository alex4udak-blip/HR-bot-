"""Dynamic HR tags — auto-derived «HR: …» labels on a candidate.

An HR-tag marks a recruiter who pulled this candidate into a funnel. The set is
derived from ``VacancyApplication.created_by`` across the candidate's ACTIVE
applications (``rejected`` / ``withdrawn`` excluded — see design §4: a rejected /
withdrawn candidate is no longer that HR's responsibility) and stored, read-only,
in ``entity.extra_data["system_hr_tags"]`` as a list of
``{"hr_id", "name", "vacancy_id", "vacancy_title"}`` — one per (HR, funnel).

Storage is deliberately separate from the manual string ``Entity.tags`` so the
two never collide: sync never touches ``tags``, manual edits never touch this.

This module is the SINGLE source of truth for the computation. The one-shot bulk
backfill in ``start.sh`` mirrors the exact same rule in SQL — keep them in sync.
"""
import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.database import Entity, User, VacancyApplication, ApplicationStage, Vacancy

logger = logging.getLogger("hr-analyzer.hr_tags")

# Заявки в этих стадиях НЕ считаются активной вовлечённостью HR: кандидат снят
# с процесса, рекрутер за него больше не отвечает (design §4). Их created_by
# не порождает метку. Любая другая стадия = активная воронка → метка.
INACTIVE_STAGES = (ApplicationStage.rejected, ApplicationStage.withdrawn)

# Ключ в extra_data, где живут авто-метки HR (read-only массив [{hr_id, name}]).
EXTRA_KEY = "system_hr_tags"


async def compute_hr_tags(db: AsyncSession, entity_id: int) -> list[dict]:
    """HR + воронка, в которую он забрал кандидата (активные заявки).

    По одной записи на (HR, вакансия) активной заявки кандидата. Возвращает
    ``[{"hr_id": int, "name": str, "vacancy_id": int, "vacancy_title": str}]``,
    отсортированный по ``(hr_id, vacancy_id)`` — стабильный порядок нужен для
    дешёвого diff в :func:`sync_for_entity`. Один HR, добавивший кандидата в
    несколько воронок, даёт несколько записей (по одной на воронку).

    NULL ``created_by`` (системные заявки) отсекаются самим INNER JOIN на users.
    """
    rows = await db.execute(
        select(User.id, User.name, Vacancy.id, Vacancy.title)
        .join(VacancyApplication, VacancyApplication.created_by == User.id)
        .join(Vacancy, Vacancy.id == VacancyApplication.vacancy_id)
        .where(
            VacancyApplication.entity_id == entity_id,
            VacancyApplication.stage.not_in(INACTIVE_STAGES),
        )
        .distinct()
        .order_by(User.id, Vacancy.id)
    )
    return [
        {"hr_id": uid, "name": name, "vacancy_id": vid, "vacancy_title": vtitle}
        for uid, name, vid, vtitle in rows.all()
    ]


async def sync_for_entity(
    db: AsyncSession, entity_id: int, *, commit: bool = True
) -> bool:
    """Пересчитывает ``system_hr_tags`` кандидата и пишет в ``extra_data``.

    Diff-guard: если набор HR не изменился — НИЧЕГО не пишем и не коммитим, так
    что горячий путь (self-heal при каждом открытии карточки) остаётся
    фактически read-only. Возвращает ``True``, если данные поменялись.

    ``version`` (optimistic-lock) НЕ трогаем намеренно: это служебная
    синхронизация, а не пользовательская правка — она не должна конфликтовать с
    параллельным редактированием карточки.
    """
    entity = await db.get(Entity, entity_id)
    if entity is None:
        return False

    new_tags = await compute_hr_tags(db, entity_id)
    current = (entity.extra_data or {}).get(EXTRA_KEY) or []

    if current == new_tags:
        return False

    # Reassign целиком (не in-place мутация) — только так SQLAlchemy замечает
    # изменение JSON-колонки (тот же приём, что crud.update_entity).
    merged = dict(entity.extra_data or {})
    if new_tags:
        merged[EXTRA_KEY] = new_tags
    else:
        merged.pop(EXTRA_KEY, None)  # нет активных HR → убираем ключ совсем
    entity.extra_data = merged

    if commit:
        await db.commit()
    logger.info(
        "HR-tags synced for entity %s: %s",
        entity_id,
        [t["name"] for t in new_tags],
    )
    return True


async def backfill_all(db: AsyncSession) -> int:
    """Пересчитывает ``system_hr_tags`` для всех кандидатов с заявками.

    Возвращает число изменённых сущностей. Используется тестами и как
    Python-эквивалент SQL-бэкафилла из ``start.sh`` (тот же результат).
    """
    rows = await db.execute(select(VacancyApplication.entity_id).distinct())
    entity_ids = [r[0] for r in rows.all() if r[0] is not None]

    changed = 0
    for eid in entity_ids:
        if await sync_for_entity(db, eid, commit=False):
            changed += 1
    await db.commit()
    return changed
