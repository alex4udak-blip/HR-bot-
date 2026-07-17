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
