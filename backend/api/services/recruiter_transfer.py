"""Передача всего владения одного рекрутёра другому («Передать всё от X к Y»).

Сценарий: рекрутёр увольняется, его аккаунт удалят. При удалении все ссылки на
него обнуляются (created_by→NULL у заявок/вакансий/кандидатов), и работа
осиротеет. Поэтому ПЕРЕД удалением админ передаёт всё владение живому рекрутёру:

  • заявки (VacancyApplication.created_by)  X → Y  — это же чинит HR-метки,
    т.к. они производны от created_by заявок (пересчитываем sync_for_entity);
  • вакансии: created_by, hiring_manager_id, а также участие в общей воронке
    (assigned_to / extra_data.accepted_by / dismissed_by)  X → Y;
  • кандидаты (Entity.created_by)  X → Y  — «мои кандидаты» уходящего.

Историю (кто менял этап, автор старых комментариев) НЕ переписываем — это факты,
а имя автора у заметок хранится снимком и переживает удаление.

Всё строго в рамках ОДНОЙ организации.
"""
from typing import Dict

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.database import Entity, Vacancy, VacancyApplication


async def reassign_recruiter_ownership(
    db: AsyncSession, org_id: int, from_user_id: int, to_user_id: int
) -> Dict[str, int]:
    """Передать всё владение from_user_id → to_user_id в пределах org_id.

    Возвращает счётчики перенесённого. Коммитит сам.
    """
    if from_user_id == to_user_id:
        raise ValueError("from и to не могут совпадать")

    counts: Dict[str, int] = {
        "applications": 0,
        "vacancies": 0,
        "candidates": 0,
        "funnels_participation": 0,
    }

    org_vacancy_ids = select(Vacancy.id).where(Vacancy.org_id == org_id)

    # 1. Заявки уходящего → на нового. Сначала соберём затронутые карточки, чтобы
    # потом пересчитать у них HR-метки (они читают created_by заявок).
    affected_entities = set(
        (
            await db.execute(
                select(VacancyApplication.entity_id).where(
                    VacancyApplication.created_by == from_user_id,
                    VacancyApplication.vacancy_id.in_(org_vacancy_ids),
                )
            )
        ).scalars().all()
    )
    res = await db.execute(
        update(VacancyApplication)
        .where(
            VacancyApplication.created_by == from_user_id,
            VacancyApplication.vacancy_id.in_(org_vacancy_ids),
        )
        .values(created_by=to_user_id)
    )
    counts["applications"] = res.rowcount or 0

    # 2. Вакансии: авторство + ведущий менеджер.
    res = await db.execute(
        update(Vacancy)
        .where(Vacancy.org_id == org_id, Vacancy.created_by == from_user_id)
        .values(created_by=to_user_id)
    )
    counts["vacancies"] = res.rowcount or 0
    await db.execute(
        update(Vacancy)
        .where(Vacancy.org_id == org_id, Vacancy.hiring_manager_id == from_user_id)
        .values(hiring_manager_id=to_user_id)
    )

    # 3. Участие в общей воронке (JSON-поля): assigned_to + accepted_by заменяем
    # X→Y (с дедупом), из dismissed_by убираем обоих — новый ведущий не должен
    # быть «снятым», а уходящий там больше не нужен.
    vacs = (
        await db.execute(select(Vacancy).where(Vacancy.org_id == org_id))
    ).scalars().all()
    for v in vacs:
        touched = False

        assigned = list(v.assigned_to or [])
        if from_user_id in assigned:
            v.assigned_to = list(
                dict.fromkeys(to_user_id if u == from_user_id else u for u in assigned)
            )
            touched = True

        ed = dict(v.extra_data or {})
        ed_changed = False

        accepted = list(ed.get("accepted_by") or [])
        if from_user_id in accepted:
            ed["accepted_by"] = list(
                dict.fromkeys(to_user_id if u == from_user_id else u for u in accepted)
            )
            ed_changed = True

        dismissed = list(ed.get("dismissed_by") or [])
        new_dismissed = [u for u in dismissed if u not in (from_user_id, to_user_id)]
        if new_dismissed != dismissed:
            ed["dismissed_by"] = new_dismissed
            ed_changed = True

        if ed_changed:
            v.extra_data = ed
            touched = True
        if touched:
            counts["funnels_participation"] += 1

    # 4. Кандидаты, которых завёл уходящий → на нового («мои кандидаты»).
    res = await db.execute(
        update(Entity)
        .where(Entity.org_id == org_id, Entity.created_by == from_user_id)
        .values(created_by=to_user_id)
    )
    counts["candidates"] = res.rowcount or 0

    await db.flush()

    # 5. Пересчёт HR-меток на затронутых карточках (теперь укажут на нового).
    from .hr_tags import sync_for_entity

    for eid in affected_entities:
        try:
            await sync_for_entity(db, eid, commit=False)
        except Exception:  # noqa: BLE001 — одна битая карточка не должна валить перенос
            pass

    await db.commit()
    return counts
