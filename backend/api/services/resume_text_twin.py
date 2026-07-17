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
    """Собрать сравниваемый текст из about + experience[].description/achievements."""
    ed = extra_data if isinstance(extra_data, dict) else {}
    parts = []
    if isinstance(ed.get("about"), str):
        parts.append(ed["about"])
    for item in (ed.get("experience") or []):
        if not isinstance(item, dict):
            continue
        if isinstance(item.get("description"), str):
            parts.append(item["description"])
        for ach in (item.get("achievements") or []):
            if isinstance(ach, str):
                parts.append(ach)
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
        ne = dict(ed)
        ne["text_twin"] = {"twin_id": best_id, "similarity": round(best_sim, 3)}
        entity.extra_data = ne
        return best_id, best_sim
    return None, 0.0
