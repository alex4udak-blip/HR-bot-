"""Доска «Штат» и база «Все кандидаты» — одна система.

Владелец, 20.10.2026: «если я на борде меняю статус у сотрудника с практики на
уволен, то в ATS он тоже перемещается в статус отказ». До этого доска меняла
только `Entity.status`, а заявка в воронке оставалась там, где была: на проде
20.10.2026 у трёх уволенных (Пак, Беляков, Лушников) заявки так и висели на
«Оффер принят», а в «Все кандидаты» они лежали в колонке «Вне воронки» —
`dismissed`/`quit` там колонками не были.

Что делает этот модуль: доводит заявки кандидата до статуса, выставленного на
доске, и пишет об этом запись в историю (`StageTransition`), чтобы перевод был
виден в ленте и попадал в дату перевода.

Правила (ровно как в «Все кандидаты», плюс увольнение):
  • УВОЛЕН / УВОЛИЛСЯ — человек ушёл целиком, поэтому отказом закрываются ВСЕ
    его живые заявки: в найме он больше не участвует ни в одной воронке.
  • Остальные статусы доски (оффер принят, практика, перешёл в отдел) —
    переносим этап, только если живая заявка ОДНА. При нескольких непонятно,
    в какой воронке менять, и можно затереть чужую (то же правило в
    `update_entity_status`); такой случай просто пишем в лог.
Обратно (уволен → практика) этапы не возвращаем: отказ в воронке — решение
рекрутёра, и воскрешать заявки молча нельзя.
"""
import logging
from datetime import datetime
from typing import Any, List

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.database import (
    ApplicationStage, EntityStatus, STATUS_SYNC_MAP, StageTransition, Vacancy,
    VacancyApplication, VacancyStatus,
)

logger = logging.getLogger("hr-analyzer.board-status-sync")

# Ушёл из штата: в воронке это «Отказ» — своего этапа у увольнения нет.
FIRED_STATUSES = (EntityStatus.dismissed, EntityStatus.quit)
# Заявка уже закрыта — трогать нечего.
CLOSED_STAGES = (ApplicationStage.rejected, ApplicationStage.withdrawn)


async def sync_applications_to_status(
    db: AsyncSession, entity: Any, new_status: EntityStatus, user: Any
) -> List[int]:
    """Довести заявки кандидата до статуса с доски. Не коммитит.

    Возвращает id заявок, которые реально переехали.
    """
    target = (
        ApplicationStage.rejected
        if new_status in FIRED_STATUSES
        else STATUS_SYNC_MAP.get(new_status)
    )
    if target is None:
        return []

    apps = (await db.execute(
        select(VacancyApplication)
        .join(Vacancy, Vacancy.id == VacancyApplication.vacancy_id)
        .where(
            VacancyApplication.entity_id == entity.id,
            Vacancy.status != VacancyStatus.closed,
        )
    )).scalars().all()
    live = [a for a in apps if a.stage not in CLOSED_STAGES]
    if not live:
        return []

    if new_status not in FIRED_STATUSES and len(live) > 1:
        logger.info(
            "BOARD_STAGE_SYNC skip: entity=%s статус %s, живых заявок %s — "
            "неясно, какую воронку двигать",
            entity.id, new_status.value, len(live),
        )
        return []

    now = datetime.utcnow()
    moved: List[int] = []
    for app in live:
        if app.stage == target:
            continue
        db.add(StageTransition(
            application_id=app.id,
            entity_id=entity.id,
            from_stage=app.stage.value if hasattr(app.stage, "value") else str(app.stage),
            to_stage=target.value,
            changed_by=getattr(user, "id", None),
            comment="Перевод с доски «Штат»",
            created_at=now,
        ))
        logger.info(
            "BOARD_STAGE_SYNC: entity=%s app=%s воронка=%s %s -> %s (статус %s, кто %s)",
            entity.id, app.id, app.vacancy_id, app.stage, target.value,
            new_status.value, getattr(user, "id", None),
        )
        app.stage = target
        app.last_stage_change_at = now
        app.updated_at = now
        moved.append(app.id)
    return moved
