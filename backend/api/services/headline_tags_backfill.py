"""Перенос ярких ярлыков у ФИО из extra_data в общий справочник меток.

До объединения теги у имени были свободным текстом внутри карточки
(``extra_data.headline_tags = [{text, color}]``), а метки — org-справочником
``entity_tags_catalog``. Две почти одинаковые сущности жили параллельно, отсюда
и «перформер» в метках рядом с «перфомер» в тегах: каталога у тегов не было,
и каждый вписывал слово заново.

Теперь справочник один, а «показывать у имени» — флаг на СВЯЗИ кандидат↔метка
(см. entity_tag_association.show_at_name). Этот бэкафилл переносит накопленное:
на каждый тег находит или заводит метку с тем же именем в орге кандидата и
цепляет её со ``show_at_name = True``.

Две вещи намеренно:

* ``extra_data.headline_tags`` НЕ удаляем. Фронт читает теги уже из связей, но
  исходные данные остаются — если перенос где-то соврал, откат не теряет ничего.
* Функция идемпотентна: повторный прогон не плодит ни меток, ни связей, поэтому
  её безопасно дёргать на каждом старте.
"""
import logging
from typing import Dict, Tuple

from sqlalchemy import select, insert, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.database import Entity, EntityTag, entity_tag_association

logger = logging.getLogger("hr-analyzer.headline_tags_backfill")

# Палитра тегов у имени (ключи pink/purple/...) → палитра справочника меток
# (CSS-переменные). Точных совпадений нет, берём ближайшее по тону: цвет —
# оформление, терять из-за него метку было бы глупо.
COLOR_MAP: Dict[str, str] = {
    "pink": "var(--hf-status-pink)",
    "purple": "var(--hf-status-purple)",
    "blue": "var(--hf-status-blue)",
    "teal": "var(--hf-status-cyan)",
    "green": "var(--hf-green-500)",
    "amber": "var(--hf-status-yellow)",
    "red": "var(--hf-red-500)",
}
DEFAULT_COLOR = "var(--hf-status-pink)"


def _clean(name: object) -> str:
    return name.strip() if isinstance(name, str) else ""


async def backfill_headline_tags(db: AsyncSession) -> Tuple[int, int]:
    """Переносит теги у имени в справочник. Возвращает (меток создано, связей создано)."""
    rows = (await db.execute(
        select(Entity.id, Entity.org_id, Entity.extra_data)
        .where(Entity.extra_data.is_not(None))
    )).all()

    # Что уже есть в справочнике: (org_id, имя в нижнем регистре) → id метки.
    # Регистр гасим намеренно: «Перформер» и «перформер» для человека одно и то
    # же, плодить из-за заглавной буквы вторую метку незачем.
    catalog: Dict[Tuple[int, str], int] = {}
    for tag_id, org_id, name in (await db.execute(
        select(EntityTag.id, EntityTag.org_id, EntityTag.name)
    )).all():
        catalog.setdefault((org_id, _clean(name).lower()), tag_id)

    existing_links = {
        (e, t) for e, t in (await db.execute(
            select(entity_tag_association.c.entity_id, entity_tag_association.c.tag_id)
        )).all()
    }

    tags_created = 0
    links_created = 0

    for entity_id, org_id, extra in rows:
        if not isinstance(extra, dict) or org_id is None:
            continue
        raw = extra.get("headline_tags")
        if not isinstance(raw, list) or not raw:
            continue

        for item in raw:
            if not isinstance(item, dict):
                continue
            name = _clean(item.get("text"))
            if not name:
                continue
            color = COLOR_MAP.get(item.get("color") or "", DEFAULT_COLOR)

            key = (org_id, name.lower())
            tag_id = catalog.get(key)
            if tag_id is None:
                tag_id = (await db.execute(
                    insert(EntityTag.__table__)
                    .values(org_id=org_id, name=name, color=color, kind="general")
                    .returning(EntityTag.id)
                )).scalar_one()
                catalog[key] = tag_id
                tags_created += 1

            if (entity_id, tag_id) in existing_links:
                # Метка уже висит как обычная — поднимаем её к имени, но не
                # снимаем, если она там уже стоит.
                await db.execute(
                    update(entity_tag_association)
                    .where(
                        entity_tag_association.c.entity_id == entity_id,
                        entity_tag_association.c.tag_id == tag_id,
                        entity_tag_association.c.show_at_name.is_(False),
                    )
                    .values(show_at_name=True)
                )
                continue

            await db.execute(
                insert(entity_tag_association)
                .values(entity_id=entity_id, tag_id=tag_id, show_at_name=True)
            )
            existing_links.add((entity_id, tag_id))
            links_created += 1

    if tags_created or links_created:
        await db.commit()
        logger.info(
            "Теги у имени перенесены в справочник: меток создано %s, связей %s",
            tags_created, links_created,
        )
    return tags_created, links_created
