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
from typing import Dict, List, Optional, Set

from sqlalchemy import select, update, func
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.database import Entity, EntityType, Vacancy, VacancyApplication


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
        assigned = list(v.assigned_to or [])
        ed = dict(v.extra_data or {})
        accepted = list(ed.get("accepted_by") or [])
        # «Участвует» = уходящий назначен ИЛИ принял воронку.
        if from_user_id not in assigned and from_user_id not in accepted:
            continue

        # Получатель становится ведущим: убираем X, добавляем Y в assigned_to и
        # accepted_by (по последнему группируется сайдбар — иначе воронка «повиснет»
        # в «Без исполнителя» и перенос не будет виден).
        new_assigned = [u for u in assigned if u != from_user_id]
        if to_user_id not in new_assigned:
            new_assigned.append(to_user_id)
        v.assigned_to = new_assigned

        new_accepted = [u for u in accepted if u != from_user_id]
        if to_user_id not in new_accepted:
            new_accepted.append(to_user_id)
        ed["accepted_by"] = new_accepted
        ed["dismissed_by"] = [
            u for u in (ed.get("dismissed_by") or [])
            if u not in (from_user_id, to_user_id)
        ]
        v.extra_data = ed
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


def _participant_of(v: Vacancy, uid: int) -> bool:
    """Уходящий — участник этой воронки: создатель / ведущий менеджер / назначен."""
    if v.created_by == uid or v.hiring_manager_id == uid:
        return True
    if uid in (v.assigned_to or []):
        return True
    acc = (v.extra_data or {}).get("accepted_by") or []
    return uid in acc


async def get_handover_summary(
    db: AsyncSession, org_id: int, from_user_id: int
) -> Dict[str, object]:
    """Что можно передать от уходящего: его воронки (с числом ЕГО кандидатов) +
    кандидаты ВНЕ воронок. Для UI раздельной передачи."""
    # Только живые воронки: мягко удалённые (deleted_at) не показываем.
    vacs = (
        await db.execute(
            select(Vacancy).where(
                Vacancy.org_id == org_id, Vacancy.deleted_at.is_(None)
            )
        )
    ).scalars().all()

    # Число кандидатов уходящего (created_by) в каждой вакансии — то, что уедет.
    own_counts_rows = (
        await db.execute(
            select(VacancyApplication.vacancy_id, func.count(VacancyApplication.id))
            .join(Vacancy, Vacancy.id == VacancyApplication.vacancy_id)
            .where(
                Vacancy.org_id == org_id,
                VacancyApplication.created_by == from_user_id,
            )
            .group_by(VacancyApplication.vacancy_id)
        )
    ).all()
    own_counts = {vid: n for vid, n in own_counts_rows}

    funnels: List[Dict[str, object]] = []
    for v in vacs:
        if _participant_of(v, from_user_id) or v.id in own_counts:
            funnels.append({
                "vacancy_id": v.id,
                "title": v.title,
                "candidates": int(own_counts.get(v.id, 0)),
            })
    # Сначала воронки с кандидатами уходящего (их и передают в первую очередь).
    funnels.sort(key=lambda f: (-int(f["candidates"]), (f["title"] or "").lower()))

    # Кандидаты уходящего ВНЕ любых воронок (created_by, без единой заявки).
    pool = (
        await db.execute(
            select(func.count(Entity.id)).where(
                Entity.org_id == org_id,
                Entity.type == EntityType.candidate,
                Entity.created_by == from_user_id,
                ~Entity.id.in_(select(VacancyApplication.entity_id)),
            )
        )
    ).scalar() or 0

    return {"funnels": funnels, "pool_candidates": int(pool)}


async def _reassign_one_vacancy(
    db: AsyncSession, org_id: int, from_user_id: int, to_user_id: int, vacancy: Vacancy,
    counts: Dict[str, int], affected: Set[int],
) -> None:
    """Перенести владение ОДНОЙ воронкой X → Y: заявки X, кандидаты этих заявок,
    авторство/участие вакансии."""
    eids = (
        await db.execute(
            select(VacancyApplication.entity_id).where(
                VacancyApplication.vacancy_id == vacancy.id,
                VacancyApplication.created_by == from_user_id,
            )
        )
    ).scalars().all()
    affected.update(eids)

    res = await db.execute(
        update(VacancyApplication)
        .where(
            VacancyApplication.vacancy_id == vacancy.id,
            VacancyApplication.created_by == from_user_id,
        )
        .values(created_by=to_user_id)
    )
    counts["applications"] += res.rowcount or 0

    if eids:
        res = await db.execute(
            update(Entity)
            .where(Entity.id.in_(eids), Entity.created_by == from_user_id)
            .values(created_by=to_user_id)
        )
        counts["candidates"] += res.rowcount or 0

    if vacancy.created_by == from_user_id:
        vacancy.created_by = to_user_id
    if vacancy.hiring_manager_id == from_user_id:
        vacancy.hiring_manager_id = to_user_id

    # Получатель СТАНОВИТСЯ ведущим воронки: убираем X, добавляем Y в assigned_to
    # И в accepted_by. accepted_by критичен — сайдбар «Мои вакансии» группирует
    # строго по нему; без Y там воронка «повисла бы» в «Без исполнителя» и
    # визуально перенос был бы незаметен.
    at = [u for u in (vacancy.assigned_to or []) if u != from_user_id]
    if to_user_id not in at:
        at.append(to_user_id)
    vacancy.assigned_to = at

    ed = dict(vacancy.extra_data or {})
    acc = [u for u in (ed.get("accepted_by") or []) if u != from_user_id]
    if to_user_id not in acc:
        acc.append(to_user_id)
    ed["accepted_by"] = acc
    ed["dismissed_by"] = [
        u for u in (ed.get("dismissed_by") or []) if u not in (from_user_id, to_user_id)
    ]
    vacancy.extra_data = ed

    counts["vacancies"] += 1


async def reassign_recruiter_split(
    db: AsyncSession,
    org_id: int,
    from_user_id: int,
    assignments: List[Dict[str, int]],
    pool_to_user_id: Optional[int] = None,
) -> Dict[str, int]:
    """Раздельная передача: каждую воронку — своему получателю, кандидатов вне
    воронок — отдельному. assignments: [{vacancy_id, to_user_id}].

    Одну воронку разным людям отдать нельзя (последнее назначение побеждает — но
    UI не даёт дублей). Всё строго в рамках org_id.
    """
    counts = {"vacancies": 0, "applications": 0, "candidates": 0}
    affected: Set[int] = set()

    for a in assignments:
        vid = a.get("vacancy_id")
        to = a.get("to_user_id")
        if not vid or not to or to == from_user_id:
            continue
        v = await db.get(Vacancy, vid)
        if v is None or v.org_id != org_id or v.deleted_at is not None:
            continue
        await _reassign_one_vacancy(db, org_id, from_user_id, to, v, counts, affected)

    # Кандидаты вне воронок → отдельному получателю.
    if pool_to_user_id and pool_to_user_id != from_user_id:
        pool_ids = (
            await db.execute(
                select(Entity.id).where(
                    Entity.org_id == org_id,
                    Entity.type == EntityType.candidate,
                    Entity.created_by == from_user_id,
                    ~Entity.id.in_(select(VacancyApplication.entity_id)),
                )
            )
        ).scalars().all()
        if pool_ids:
            res = await db.execute(
                update(Entity)
                .where(Entity.id.in_(pool_ids))
                .values(created_by=pool_to_user_id)
            )
            counts["candidates"] += res.rowcount or 0

    await db.flush()

    from .hr_tags import sync_for_entity
    for eid in affected:
        try:
            await sync_for_entity(db, eid, commit=False)
        except Exception:  # noqa: BLE001
            pass

    await db.commit()
    return counts
