"""Умный поиск кандидатов: денормализованное search_name + матчер по pg_trgm.

Заказчица требует поиск как в Huntflow: транслитерация (Roman Fattakhov =
Роман Фаттахов), любой порядок слов, терпимость к опечаткам, одно окно без
настроек. Архитектура (согласована): вся тяжёлая работа — в PostgreSQL по
триграммному индексу; Python лишь готовит варианты запроса (несколько слов).

- build_search_name — денормализованный блоб: ФИО в ДВУХ алфавитах (через
  similarity.generate_name_variants) + должность/компания/теги. Пишется в
  entities.search_name на insert/update (event-листенеры ниже), индексируется
  GIN-триграммой (см. start.sh).
- smart_name_filter / smart_name_score — SQL-условие и ранг для запроса: каждое
  слово запроса (в любом алфавите) триграммно присутствует в search_name,
  порядок не важен, опечатки прощаются (word_similarity).
"""
import re
from typing import Optional, List
from sqlalchemy import event, func, or_, and_, text
from sqlalchemy.sql.elements import ColumnElement

from ..models.database import Entity
from .similarity import (
    generate_name_variants, _name_word_variants,
    transliterate_ru_to_en, transliterate_en_to_ru,
)

# Доступно ли расширение pg_trgm (нужно для оператора %> и word_similarity).
# None — ещё не проверяли; True/False — установлено ли. На managed-Postgres без
# superuser расширение может не встать (см. start.sh best-effort) — тогда поиск
# ДЕГРАДИРУЕТ до старого ILIKE, а не падает 500 на несуществующем операторе.
_pg_trgm_available: Optional[bool] = None


async def ensure_pg_trgm_checked(db) -> bool:
    """Один раз (с кэшем) проверяет наличие pg_trgm по переданной сессии. Вызывать
    в поисковых эндпоинтах ДО построения запроса, чтобы smart_*-матчер знал, можно
    ли использовать триграммы."""
    global _pg_trgm_available
    if _pg_trgm_available is None:
        try:
            r = await db.execute(text("SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'"))
            _pg_trgm_available = r.first() is not None
        except Exception:
            _pg_trgm_available = False
    return _pg_trgm_available


def set_pg_trgm_available(value: bool) -> None:
    """Явно выставить флаг (для тестов/скриптов без ensure-проверки)."""
    global _pg_trgm_available
    _pg_trgm_available = value


def build_search_name(
    name: Optional[str],
    position: Optional[str] = None,
    company: Optional[str] = None,
    tags: Optional[List[str]] = None,
) -> str:
    """Денормализованный поисковый блоб: ФИО в двух алфавитах + должность/компания/теги."""
    parts = set()
    if name:
        parts |= generate_name_variants(name)
    for f in (position, company):
        if f and str(f).strip():
            parts.add(str(f).strip().lower())
    # tags может прийти JSON-строкой (напр. из raw-SQL бэкфилла) — распарсим.
    if isinstance(tags, str):
        import json as _json
        try:
            tags = _json.loads(tags)
        except Exception:
            tags = []
    for t in (tags or []):
        if isinstance(t, str) and t.strip():
            parts.add(t.strip().lower())
    parts.discard("")
    return " ".join(sorted(parts))[:3000]


def _entity_search_name(target: "Entity") -> str:
    return build_search_name(
        getattr(target, "name", None),
        getattr(target, "position", None),
        getattr(target, "company", None),
        getattr(target, "tags", None),
    )


def _on_insert(mapper, connection, target):
    target.search_name = _entity_search_name(target)


def _on_update(mapper, connection, target):
    new_val = _entity_search_name(target)
    if target.search_name != new_val:
        target.search_name = new_val


def register_search_events() -> None:
    """Автосинк entities.search_name на insert/update. Идемпотентно."""
    if not event.contains(Entity, "before_insert", _on_insert):
        event.listen(Entity, "before_insert", _on_insert)
    if not event.contains(Entity, "before_update", _on_update):
        event.listen(Entity, "before_update", _on_update)


def query_tokens(q: str) -> List[str]:
    """Слова запроса (≥2 символов, lowercase)."""
    return [w for w in re.split(r"\s+", (q or "").strip().lower()) if len(w.strip("-_.,")) >= 2]


# Раскладка клавиатуры ЙЦУКЕН(RU) ↔ QWERTY(EN): один и тот же ФИЗИЧЕСКИЙ клавиш.
# «иван», набранное в EN-раскладке, выглядит как «bdfy»; перевернув раскладку —
# снова «иван». Это НЕ транслитерация (та фонетическая: ivan→иван) — тут
# соответствие клавиш. Частая жалоба: искал «иван», забыл переключить язык.
_RU_TO_EN_LAYOUT = {
    "й": "q", "ц": "w", "у": "e", "к": "r", "е": "t", "н": "y", "г": "u",
    "ш": "i", "щ": "o", "з": "p", "х": "[", "ъ": "]",
    "ф": "a", "ы": "s", "в": "d", "а": "f", "п": "g", "р": "h", "о": "j",
    "л": "k", "д": "l", "ж": ";", "э": "'",
    "я": "z", "ч": "x", "с": "c", "м": "v", "и": "b", "т": "n", "ь": "m",
    "б": ",", "ю": ".", "ё": "`",
}
_EN_TO_RU_LAYOUT = {v: k for k, v in _RU_TO_EN_LAYOUT.items()}


def switch_layout(q: str) -> str:
    """Флип раскладки RU↔EN по физическим клавишам. Латиница → трактуем как
    EN-раскладку и переводим в кириллицу («bdfy»→«иван»); кириллица → наоборот.
    Неотображаемые символы остаются как есть. Мусорные результаты (напр. «ivan»→
    «шмфт») просто ничего не находят — безвредны."""
    if not q:
        return ""
    mapping = _RU_TO_EN_LAYOUT if re.search(r"[а-яёА-ЯЁ]", q) else _EN_TO_RU_LAYOUT
    return "".join(mapping.get(ch, ch) for ch in q.lower())


def _search_word_variants(tok: str) -> set:
    """Словоформы слова для поиска: транслит-варианты (_name_word_variants) +
    вариант с перевёрнутой раскладкой и уже ЕГО транслит-варианты
    («bdfy» → «иван» → …). Отдельно от similarity._name_word_variants, чтобы НЕ
    засорять раскладкой дедуп кандидатов."""
    variants = set(_name_word_variants(tok) or {tok})
    sw = switch_layout(tok)
    if sw and sw != tok:
        variants.add(sw)
        variants |= (_name_word_variants(sw) or set())
    return variants


def smart_name_filter(q: str) -> Optional[ColumnElement]:
    """SQL-условие: КАЖДОЕ слово запроса (в любом алфавите, с опечатками)
    триграммно присутствует в search_name. Порядок слов не важен (AND по словам,
    OR по вариантам). None — если pg_trgm недоступен или нет значимых токенов."""
    if not _pg_trgm_available:
        return None
    tokens = query_tokens(q)
    if not tokens:
        return None
    per_token = []
    for tok in tokens:
        variants = _search_word_variants(tok)
        # search_name %> v  ==  word_similarity(v, search_name) >= threshold  (использует GIN-триграмму)
        per_token.append(or_(*[Entity.search_name.op("%>")(v) for v in variants]))
    return and_(*per_token)


def smart_name_score(q: str) -> Optional[ColumnElement]:
    """Ранг: сумма лучших пословных word_similarity (точнее совпал — выше).
    None — если pg_trgm недоступен (тогда сортировка остаётся прежней)."""
    if not _pg_trgm_available:
        return None
    tokens = query_tokens(q)
    if not tokens:
        return None
    terms = []
    for tok in tokens:
        variants = _search_word_variants(tok)
        terms.append(func.greatest(*[func.word_similarity(v, Entity.search_name) for v in variants]))
    expr = terms[0]
    for t in terms[1:]:
        expr = expr + t
    return expr


def _translit_ilike_patterns(q: str) -> List[str]:
    """ILIKE-паттерны имени с транслитерацией RU<->EN (fallback, работает без pg_trgm)."""
    q = (q or "").strip()
    terms = {q}
    if re.search(r"[а-яёА-ЯЁ]", q):
        terms.add(transliterate_ru_to_en(q))
    if re.search(r"[a-zA-Z]", q):
        terms.add(transliterate_en_to_ru(q))
    sw = switch_layout(q)  # раскладка: «bdfy» → «иван»
    if sw and sw != q.lower():
        terms.add(sw)
    return [f"%{t}%" for t in terms if t]


def name_search_conditions(q: str) -> List:
    """OR-условия поиска кандидата по ИМЕНИ для ЛЮБОГО окна поиска: умный
    pg_trgm-матч (транслит + любой порядок слов + опечатки, если pg_trgm доступен)
    + транслит-ILIKE как fallback. Вызывать ПОСЛЕ ensure_pg_trgm_checked(db).
    Использование: base.where(or_(*name_search_conditions(q), <прочие поля>))."""
    conds: List = []
    snf = smart_name_filter(q)
    if snf is not None:
        conds.append(snf)
    for t in _translit_ilike_patterns(q):
        conds.append(Entity.name.ilike(t))
    return conds


# Регистрируем автосинк при импорте модуля (роуты поиска импортируют его на
# старте — раньше любого insert/update кандидата).
register_search_events()
