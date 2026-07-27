"""Feature B — детектор «копипаст текста резюме».

Независим от детектора личности. Сравнивает нормализованный свободный текст резюме
(about + описания/достижения опыта) двух кандидатов через шинглы N-грамм слов и
коэффициент Жаккара. Высокое сходство => подсказка «текст совпадает» (может быть тот
же человек ИЛИ плагиат чужого резюме — решает рекрутёр). Порог — стартовый, калибруется.
"""
import re
from typing import Optional, Set

# Стартовый порог сходства для флага «копипаст». Калибруется на реальных данных.
TEXT_TWIN_THRESHOLD = 0.8
SHINGLE_N = 3


def normalize_resume_text(text: str) -> str:
    """lower, убрать пунктуацию и цифры (даты/номера — шум), схлопнуть пробелы."""
    if not text:
        return ""
    s = str(text).lower()
    s = re.sub(r"[0-9]+", " ", s)
    s = re.sub(r"[^\w\s]", " ", s, flags=re.UNICODE)
    s = re.sub(r"[_]+", " ", s)
    return " ".join(s.split())


def resume_text_blob(extra_data: Optional[dict]) -> str:
    """Собрать сравниваемый текст резюме. Поддерживает ОБА формата хранения:
    - парсер резюме (загрузка файла): about + experience[].description/achievements;
    - расширение-парсер (magic_button): summary + experience_descriptions[] (плоский
      список строк). Ключи разошлись между путями, поэтому читаем оба, иначе Feature B
      не срабатывала бы на кандидатах из расширения (основной поток)."""
    ed = extra_data if isinstance(extra_data, dict) else {}
    parts = []
    # «Обо мне» — about (парсер файла) ИЛИ summary (расширение).
    for key in ("about", "summary"):
        if isinstance(ed.get(key), str):
            parts.append(ed[key])
    # Опыт — структурированный experience[] (парсер файла).
    for item in (ed.get("experience") or []):
        if not isinstance(item, dict):
            continue
        if isinstance(item.get("description"), str):
            parts.append(item["description"])
        for ach in (item.get("achievements") or []):
            if isinstance(ach, str):
                parts.append(ach)
    # Опыт — плоский список описаний (расширение: experience_descriptions).
    for desc in (ed.get("experience_descriptions") or []):
        if isinstance(desc, str):
            parts.append(desc)
    return normalize_resume_text(" ".join(parts))


def text_shingles(normalized_text: str, n: int = SHINGLE_N) -> Set[str]:
    """Множество словесных N-грамм из нормализованного текста."""
    words = normalized_text.split()
    if len(words) < n:
        return {" ".join(words)} if words else set()
    return {" ".join(words[i:i + n]) for i in range(len(words) - n + 1)}


def jaccard_similarity(a: Set[str], b: Set[str]) -> float:
    """|A∩B| / |A∪B|. 0.0 если оба пусты."""
    if not a and not b:
        return 0.0
    inter = len(a & b)
    union = len(a | b)
    return inter / union if union else 0.0


from typing import Tuple
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.database import Entity, EntityType


async def detect_resume_text_twin(db: AsyncSession, entity: Entity) -> Tuple[Optional[int], float]:
    """Найти кандидата организации с почти дословно совпадающим текстом резюме
    (Жаккар по 3-словным шинглам >= порога). Активные И архив, кроме self и
    dismissed. При нахождении пишет extra_data.text_twin = {twin_id, similarity} и
    возвращает (twin_id, similarity). Иначе (None, 0.0)."""
    my_blob = resume_text_blob(entity.extra_data)
    my_sh = text_shingles(my_blob)
    if len(my_sh) < 5:  # слишком короткий текст — не сравниваем (шум)
        return None, 0.0

    dismissed = set()
    ed = entity.extra_data if isinstance(entity.extra_data, dict) else {}
    for x in (ed.get("dismissed_duplicate_ids") or []):
        try:
            dismissed.add(int(x))
        except (TypeError, ValueError):
            pass

    rows = (await db.execute(
        select(Entity.id, Entity.extra_data).where(
            Entity.type == EntityType.candidate,
            Entity.org_id == entity.org_id,
            Entity.id != entity.id,
        )
    )).all()

    best_id, best_sim = None, 0.0
    for cand_id, cand_extra in rows:
        if cand_id in dismissed:
            continue
        sim = jaccard_similarity(my_sh, text_shingles(resume_text_blob(cand_extra)))
        if sim > best_sim:
            best_id, best_sim = cand_id, sim

    if best_id is not None and best_sim >= TEXT_TWIN_THRESHOLD:
        pct = round(best_sim * 100)
        ne = dict(ed)
        ne["text_twin"] = {"twin_id": best_id, "similarity": round(best_sim, 3)}
        # Единый баннер (Feature A): текст-твин тоже должен всплывать через
        # ShadowDuplicateBanner, но НЕ должен затирать реальное identity-совпадение
        # (detect_archived_duplicate уже отработал раньше на всех путях создания —
        # crud.py/bulk.py/magic_button.py — и, если нашёл дубль, успел проставить
        # hidden_duplicate_id ДО вызова этой функции). Identity всегда важнее.
        if not ne.get("hidden_duplicate_id"):
            ne["hidden_duplicate_id"] = best_id
            ne["hidden_duplicate_meta"] = {
                "strength": "text",
                "confidence": pct,
                "reasons": [f"Текст резюме совпадает ({pct}%)"],
                "matched_id": best_id,
            }
        entity.extra_data = ne

        # Обратная ссылка на найденном твине — баннер должен показаться и у НЕГО,
        # как это уже делает detect_archived_duplicate для identity-дублей. Не
        # перетираем существующий флаг твина (identity или чужой text-twin) и не
        # трогаем уже отклонённые им пары.
        twin = (await db.execute(select(Entity).where(Entity.id == best_id))).scalar_one_or_none()
        if twin is not None:
            de = twin.extra_data if isinstance(twin.extra_data, dict) else {}
            tdis = set()
            for x in (de.get("dismissed_duplicate_ids") or []):
                try:
                    tdis.add(int(x))
                except (TypeError, ValueError):
                    pass
            if entity.id not in tdis and not de.get("hidden_duplicate_id"):
                nde = dict(de)
                nde["hidden_duplicate_id"] = entity.id
                nde["hidden_duplicate_meta"] = {
                    "strength": "text",
                    "confidence": pct,
                    "reasons": [f"Текст резюме совпадает ({pct}%)"],
                    "matched_id": entity.id,
                }
                twin.extra_data = nde
        return best_id, best_sim
    return None, 0.0
