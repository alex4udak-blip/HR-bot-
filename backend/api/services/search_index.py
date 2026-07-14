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
from sqlalchemy import event, func, or_, and_
from sqlalchemy.sql.elements import ColumnElement

from ..models.database import Entity
from .similarity import generate_name_variants, _name_word_variants


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


def smart_name_filter(q: str) -> Optional[ColumnElement]:
    """SQL-условие: КАЖДОЕ слово запроса (в любом алфавите, с опечатками)
    триграммно присутствует в search_name. Порядок слов не важен (AND по словам,
    OR по вариантам). None — если значимых токенов нет."""
    tokens = query_tokens(q)
    if not tokens:
        return None
    per_token = []
    for tok in tokens:
        variants = _name_word_variants(tok) or {tok}
        # search_name %> v  ==  word_similarity(v, search_name) >= threshold  (использует GIN-триграмму)
        per_token.append(or_(*[Entity.search_name.op("%>")(v) for v in variants]))
    return and_(*per_token)


def smart_name_score(q: str) -> Optional[ColumnElement]:
    """Ранг: сумма лучших пословных word_similarity (точнее совпал — выше)."""
    tokens = query_tokens(q)
    if not tokens:
        return None
    terms = []
    for tok in tokens:
        variants = _name_word_variants(tok) or {tok}
        terms.append(func.greatest(*[func.word_similarity(v, Entity.search_name) for v in variants]))
    expr = terms[0]
    for t in terms[1:]:
        expr = expr + t
    return expr


# Регистрируем автосинк при импорте модуля (роуты поиска импортируют его на
# старте — раньше любого insert/update кандидата).
register_search_events()
