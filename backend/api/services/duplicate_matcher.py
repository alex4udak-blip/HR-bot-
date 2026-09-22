"""ЕДИНОЕ ядро сравнения кандидатов на дубль.

Зачем модуль появился (этап 0 переделки дедупа). До него решение «это тот же
человек» принимали ПЯТЬ независимых кусков кода с разошедшимися правилами:

1. ``similarity.find_duplicate_matches`` — тиры source/email/telegram/name/phone +
   мягкий скоринг; питает баннер «Похожий кандидат» и расширение hh.ru;
2. ``similarity.detect_duplicates`` — своя шкала (имя 40, email 30, телефон 30,
   telegram 30, компания+навыки 20, порог 30); питает окно сравнения;
3. ``services/duplicates.py`` — третья шкала (0.5/0.35/0.15), мёртвый код;
4. ``routes/entities/crud.rescan_active_duplicates`` — свой индекс ключей, ФИО
   сверялось ТОЧНОЙ строкой (без транслита и отчеств);
5. ``routes/entities/crud.find_archive_duplicates`` — union-find вообще без ФИО.

Из-за этого баннер и карточка сравнения показывали РАЗНЫЕ проценты по одной паре,
а пере-скан находил не то же самое, что детект на создании.

Теперь правило одно: :func:`compare_key_sets` — чистая функция над двумя наборами
ключей ``build_dup_keys``. Всё остальное (обход БД, блокировка-индекс, обёртки для
роутов) построено вокруг неё.

Уровни (``strength``), в порядке приоритета:
    source  — тот же канонический URL резюме;
    email   — полный адрес ИЛИ локальная часть до «@»;
    telegram— личный @хэндл (мусорные ярлыки источника отсеяны);
    name    — связка Фамилия+Имя (транслит, отчества, гомоглифы, опечатка ≤1);
    phone   — последние 10 цифр;
    soft    — мягкий скоринг личности (``score_soft_identity`` ≥ порога);
    text    — совпал ТЕКСТ резюме (инфо-сигнал, слияние по нему не предлагаем).

``confidence`` — ОДНО число на пару. 100 — только «точный» уровень (``level``
exact: совпало ≥2 признака личности, красный баннер). Одиночный признак —
«возможно тот же» (possible, жёлтый): сумма весов ``EVIDENCE_WEIGHTS``, для
``soft`` — балл мягкого скоринга, для ``text`` — процент Жаккара. Раньше окно сравнения считало своё,
поэтому «точное совпадение» в баннере превращалось в «30%» на карточке.
"""

import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.database import Entity, EntityType
# similarity импортирует ЭТОТ модуль внутри тел функций (ленивo), поэтому обратный
# импорт на уровне модуля цикла не создаёт.
from .similarity import (
    DupMatch,
    DupSignal,
    POSSIBLE_CONFIDENCE_CAP,
    evidence_confidence,
    match_level,
    build_dup_keys,
    email_locals_of,
    is_matchable_telegram,
    names_match_surname_firstname,
    normalize_telegram,
    score_soft_identity,
    transliterate_en_to_ru,
    fold_yo,
    fold_homoglyphs,
    TG_COMMON_THRESHOLD,
)

logger = logging.getLogger("hr-analyzer.duplicate_matcher")

# Уровни-идентификаторы в порядке убывания приоритета. Совпадение любого из них
# задаёт тир пары; «точным» (100%) пара становится только при ≥2 признаках.
IDENTITY_ORDER: Tuple[str, ...] = ("source", "email", "telegram", "name", "phone")

# Человекочитаемые причины (идут в баннер и в чипы карточки сравнения).
SIGNAL_LABELS: Dict[str, str] = {
    "source": "Та же ссылка на резюме",
    "email": "Совпадение email",
    "telegram": "Совпадение Telegram",
    "name": "Совпадение имени (с учётом транслитерации)",
    "phone": "Совпадение телефона",
    "company": "Та же компания + похожие навыки",
    "resume_text": "Текст резюме совпадает",
}


@dataclass
class CandidateKeys:
    """Кандидат, разобранный в ключи дедупа (одна строка выборки из БД)."""
    entity_id: int
    name: str
    is_archived: bool
    keys: dict
    extra_data: dict = field(default_factory=dict)


def _first(values: Sequence[str], fallback: str = "") -> str:
    for v in values:
        if v:
            return v
    return fallback


def compare_key_sets(a: dict, b: dict) -> Tuple[Optional[str], int, List[DupSignal]]:
    """ЕДИНСТВЕННОЕ место, где решается «это один человек».

    Принимает два набора ключей :func:`build_dup_keys` и возвращает
    ``(strength, confidence, signals)``. ``strength`` = None, если пара не дубль.

    Сигналы собираются ВСЕ (и сильные, и мягкие) — они нужны окну сравнения, чтобы
    подсветить ровно те поля, из-за которых пара считается дублем. ``strength`` же
    берётся по приоритету :data:`IDENTITY_ORDER`, а мягкий скоринг поднимает флаг
    только когда сильных сигналов нет (иначе «возможно тот же человек» перебивало
    бы «точное совпадение»).
    """
    signals: List[DupSignal] = []

    # --- Level-1: идентификаторы ------------------------------------------------
    a_src, b_src = a.get("source_key") or "", b.get("source_key") or ""
    if a_src and a_src == b_src:
        signals.append(DupSignal("source", SIGNAL_LABELS["source"], 100, True, a_src, b_src))

    a_emails: Set[str] = a.get("emails") or set()
    b_emails: Set[str] = b.get("emails") or set()
    full_hit = a_emails & b_emails
    local_hit = (a.get("email_locals") or email_locals_of(a_emails)) & (
        b.get("email_locals") or email_locals_of(b_emails)
    )
    if full_hit or local_hit:
        # Почта сверяется и по полному адресу, и по локали до «@»: смена домена
        # gmail→mail не уводит от дубля (служебные локали отсеяны email_locals_of).
        signals.append(DupSignal(
            "email", SIGNAL_LABELS["email"], 100, True,
            _first(sorted(full_hit) or sorted(a_emails)),
            _first(sorted(full_hit) or sorted(b_emails)),
        ))

    tg_hit = (a.get("tg_names") or set()) & (b.get("tg_names") or set())
    tg_hit = {t for t in tg_hit if is_matchable_telegram(t)}
    if tg_hit:
        signals.append(DupSignal(
            "telegram", SIGNAL_LABELS["telegram"], 100, True,
            "@" + _first(sorted(tg_hit)), "@" + _first(sorted(tg_hit)),
        ))

    a_name, b_name = a.get("name") or "", b.get("name") or ""
    if (
        a.get("name_ok") and b.get("name_ok")
        and names_match_surname_firstname(a_name, b_name)
    ):
        signals.append(DupSignal("name", SIGNAL_LABELS["name"], 100, True, a_name, b_name))

    phone_hit = (a.get("phones10") or set()) & (b.get("phones10") or set())
    if phone_hit:
        p = _first(sorted(phone_hit))
        signals.append(DupSignal("phone", SIGNAL_LABELS["phone"], 100, True, p, p))

    # --- Level-2: мягкий скоринг личности --------------------------------------
    # Считаем ВСЕГДА (не только при отсутствии сильных): его компоненты — ФИО, дата
    # рождения, 7 цифр телефона, город — это подсказки для окна сравнения.
    soft = score_soft_identity(a, b)
    # Мягкие компоненты кладём в ТЕ ЖЕ поля, что и сильные сигналы (ФИО → name,
    # 7 цифр → phone, локаль почты → email): окно сравнения подсвечивает поле, а не
    # внутреннее имя правила, и один факт не дублируется двумя строками.
    soft_fields = {
        "Фамилия и имя совпали": ("name", a_name, b_name),
        "Дата рождения совпала": ("birth_date", a.get("birth_norm") or "", b.get("birth_norm") or ""),
        "Возраст совпадает (±1 год)": ("age", str(a.get("age") or ""), str(b.get("age") or "")),
        "Последние 7 цифр телефона совпали": (
            "phone",
            _first(sorted((a.get("phones7") or set()) & (b.get("phones7") or set()))),
            _first(sorted((a.get("phones7") or set()) & (b.get("phones7") or set()))),
        ),
        "Email до @ совпал": (
            "email",
            _first(sorted(local_hit)), _first(sorted(local_hit)),
        ),
        "Telegram совпал": ("telegram", _first(sorted(tg_hit)), _first(sorted(tg_hit))),
        "Город совпал": (
            "city",
            _first(sorted((a.get("cities") or set()) & (b.get("cities") or set()))),
            _first(sorted((a.get("cities") or set()) & (b.get("cities") or set()))),
        ),
    }
    seen_fields = {s.field for s in signals}
    for reason in soft.reasons:
        fname, left, right = soft_fields.get(reason, (reason, "", ""))
        if fname in seen_fields:
            continue  # тот же факт уже описан сильным сигналом
        signals.append(DupSignal(fname, reason, 0, False, left, right))

    # --- Компания + навыки (слабый контекстный сигнал, сам дубль не поднимает) ---
    a_company, b_company = a.get("company") or "", b.get("company") or ""
    if a_company and a_company == b_company:
        a_skills: Set[str] = a.get("skills") or set()
        b_skills: Set[str] = b.get("skills") or set()
        if a_skills and b_skills:
            common = a_skills & b_skills
            if len(common) / len(a_skills | b_skills) > 0.5:
                signals.append(DupSignal(
                    "company", SIGNAL_LABELS["company"], 0, False, a_company, b_company,
                ))

    # Тир — ТОЛЬКО по сильным сигналам. Мягкие компоненты лежат в тех же полях
    # (phone7 → "phone", email-локаль → "email"), поэтому фильтр по identity
    # обязателен: иначе «совпали последние 7 цифр» выдавало бы себя за точный
    # телефон и давало 100%.
    identity_fields = {x.field for x in signals if x.identity}
    strength = next((s for s in IDENTITY_ORDER if s in identity_fields), None)
    # Процент — от ЧИСЛА совпавших признаков: 100 только при ≥2 (красный баннер),
    # одиночное совпадение — «возможно тот же человек» (решение владельца 21.09).
    if strength is not None:
        return strength, evidence_confidence(signals), signals
    if soft.is_flag:
        conf = 100 if match_level(signals) == "exact" else min(POSSIBLE_CONFIDENCE_CAP, soft.confidence)
        return "soft", conf, signals
    return None, 0, signals


def identity_block_keys(keys: dict) -> List[str]:
    """Ключи «блокировки» для пере-скана: по ним пара попадает на полное сравнение.

    Намеренно ШИРЕ, чем строгое совпадение: имя даёт ключ по канонической форме
    каждого слова (первые 4 буквы), поэтому отчества, перестановка «Фамилия Имя»
    и опечатка в хвосте слова не разводят пару по разным корзинам. Точность всё
    равно решает :func:`compare_key_sets` — здесь только отбор пар-кандидатов.
    """
    out: List[str] = []
    if keys.get("source_key"):
        out.append("s:" + keys["source_key"])
    for e in (keys.get("emails") or set()):
        out.append("e:" + e)
    for loc in (keys.get("email_locals") or set()):
        out.append("el:" + loc)
    for p in (keys.get("phones10") or set()):
        out.append("p:" + p)
    for t in (keys.get("tg_names") or set()):
        if is_matchable_telegram(t):
            out.append("t:" + t)
    if keys.get("name_ok"):
        for word in (keys.get("name") or "").split():
            w = fold_yo(fold_homoglyphs(word).lower().strip("-_.,"))
            if len(w) < 2:
                continue
            canon = w if any("а" <= ch <= "я" or ch == "ё" for ch in w) else transliterate_en_to_ru(w)
            out.append("n:" + fold_yo(canon)[:4])
    # Дедуп обязателен: «Иванов Иван» даёт ключ n:иван дважды, и кандидат попадал в
    # одну корзину два раза — то есть сравнивался сам с собой и всегда «совпадал».
    return sorted(set(out))


def keys_of_entity(entity: Entity) -> dict:
    """Ключи дедупа для ORM-сущности (обёртка над build_dup_keys)."""
    return build_dup_keys(
        name=entity.name,
        email=entity.email,
        phone=entity.phone,
        emails=entity.emails,
        phones=entity.phones,
        telegram_usernames=entity.telegram_usernames,
        extra_data=entity.extra_data,
        company=getattr(entity, "company", None),
    )


def _keys_of_row(m) -> dict:
    """Ключи из строки укороченной выборки (см. _CANDIDATE_COLUMNS)."""
    extra = m.get(Entity.extra_data)
    return build_dup_keys(
        name=m[Entity.name],
        email=m[Entity.email],
        phone=m[Entity.phone],
        emails=m.get(Entity.emails),
        phones=m.get(Entity.phones),
        telegram_usernames=m[Entity.telegram_usernames],
        extra_data=extra if isinstance(extra, dict) else {},
        company=m.get(Entity.company),
    )


_CANDIDATE_COLUMNS = [
    Entity.id, Entity.name, Entity.email, Entity.phone, Entity.emails, Entity.phones,
    Entity.telegram_usernames, Entity.is_archived, Entity.company, Entity.extra_data,
]


async def load_candidate_keys(
    db: AsyncSession,
    org_id: Optional[int],
    *,
    exclude_id: Optional[int] = None,
    include_archived: bool = True,
    archived_only: bool = False,
) -> List[CandidateKeys]:
    """Выборка кандидатов организации, разобранная в ключи дедупа.

    Пока это полный проход по кандидатам org (как и во всех прежних копиях);
    индекс по нормализованным ключам — задача этапа 1.
    """
    q = select(*_CANDIDATE_COLUMNS).where(Entity.type == EntityType.candidate)
    if org_id is not None:
        q = q.where(Entity.org_id == org_id)
    if exclude_id is not None:
        q = q.where(Entity.id != exclude_id)
    if archived_only:
        q = q.where(Entity.is_archived.is_(True))
    elif not include_archived:
        q = q.where(Entity.is_archived.is_not(True))
    rows = (await db.execute(q.order_by(Entity.id.desc()))).all()

    items: List[CandidateKeys] = []
    for r in rows:
        m = r._mapping
        extra = m[Entity.extra_data]
        items.append(CandidateKeys(
            entity_id=m[Entity.id],
            name=m[Entity.name] or "",
            is_archived=bool(m[Entity.is_archived]),
            keys=_keys_of_row(m),
            extra_data=extra if isinstance(extra, dict) else {},
        ))
    return items


def telegram_name_frequency(items: Sequence[CandidateKeys], extra_names: Optional[Dict[str, str]] = None) -> Dict[str, Set[str]]:
    """Сколько РАЗНЫХ имён стоит за каждым @хэндлом.

    Один человек, разъехавшийся на несколько карточек с одним хэндлом, даёт одно
    имя — матчим. Мусорный ярлык источника («telegram», «hh_b2b») сидит у многих
    разных имён — не идентификатор.
    """
    freq: Dict[str, Set[str]] = {}
    for it in items:
        nm = (it.name or "").strip().lower()
        for t in (it.keys.get("tg_names") or set()):
            freq.setdefault(t, set()).add(nm)
    for t, nm in (extra_names or {}).items():
        freq.setdefault(t, set()).add(nm)
    return freq


def filter_common_telegram(keys: dict, freq: Dict[str, Set[str]]) -> dict:
    """Убрать из ключей «общие» @хэндлы (у ≥ TG_COMMON_THRESHOLD разных имён)."""
    tg = {
        t for t in (keys.get("tg_names") or set())
        if is_matchable_telegram(t) and len(freq.get(t, ())) < TG_COMMON_THRESHOLD
    }
    if tg == (keys.get("tg_names") or set()):
        return keys
    out = dict(keys)
    out["tg_names"] = tg
    return out


def _text_twin_signal(
    my_extra: dict, other_id: int, other_extra: dict, self_id: Optional[int] = None,
) -> Optional[Tuple[int, DupSignal]]:
    """Инфо-сигнал «текст резюме совпадает» из УЖЕ сохранённого text_twin.

    Считается не здесь, а detect_resume_text_twin при создании кандидата (Жаккар по
    шинглам — дорого на каждую пару). Сознательно НЕ поднимает слияние: у разных
    людей бывают анкеты по одному шаблону. Читаем обе стороны связи — инициатор
    хранит extra_data.text_twin, у цели остаётся только backreference в мете.
    """
    tw = my_extra.get("text_twin")
    if isinstance(tw, dict) and tw.get("twin_id") == other_id:
        pct = round((tw.get("similarity") or 0) * 100)
        return pct, DupSignal("resume_text", f"Текст резюме совпадает ({pct}%)", 0, False, "", "")
    tw_other = other_extra.get("text_twin")
    if isinstance(tw_other, dict) and self_id is not None and tw_other.get("twin_id") == self_id:
        pct = round((tw_other.get("similarity") or 0) * 100)
        return pct, DupSignal("resume_text", f"Текст резюме совпадает ({pct}%)", 0, False, "", "")
    meta = my_extra.get("hidden_duplicate_meta")
    if isinstance(meta, dict) and meta.get("strength") == "text" and meta.get("matched_id") == other_id:
        pct = int(meta.get("confidence") or 0)
        return pct, DupSignal("resume_text", f"Текст резюме совпадает ({pct}%)", 0, False, "", "")
    return None


# Старый список «разные люди» из extra_data. Основное хранилище решений теперь
# таблица duplicate_pair_decisions — см. services/duplicate_decisions.py.
from .duplicate_decisions import legacy_dismissed as _dismissed_ids  # noqa: E402


async def match_entities(
    db: AsyncSession,
    org_id: Optional[int],
    keys: dict,
    *,
    exclude_id: Optional[int] = None,
    dismissed: Optional[Set[int]] = None,
    include_archived: bool = True,
    include_text: bool = False,
    own_extra_data: Optional[dict] = None,
    allowed_ids: Optional[Set[int]] = None,
    self_id: Optional[int] = None,
) -> List[DupMatch]:
    """Все совпадения для одного набора ключей. Порядок — id DESC (как раньше).

    ``include_text`` добавляет пары, связанные только совпадением ТЕКСТА резюме
    (окно сравнения показывает их отдельным тиром; баннер слияния — нет).
    ``allowed_ids`` — фильтр видимости (права доступа), применяется до сравнения.
    """
    dismissed = set(dismissed or set())
    items = await load_candidate_keys(
        db, org_id, exclude_id=exclude_id, include_archived=include_archived,
    )
    if allowed_ids is not None:
        items = [it for it in items if it.entity_id in allowed_ids]

    freq = telegram_name_frequency(
        items, {t: (keys.get("name") or "").strip().lower() for t in (keys.get("tg_names") or set())}
    )
    my_keys = filter_common_telegram(keys, freq)
    my_extra = own_extra_data if isinstance(own_extra_data, dict) else {}

    out: List[DupMatch] = []
    for it in items:
        if it.entity_id in dismissed:
            continue
        strength, confidence, signals = compare_key_sets(
            my_keys, filter_common_telegram(it.keys, freq)
        )
        text_hit = _text_twin_signal(
            my_extra, it.entity_id, it.extra_data, self_id if self_id is not None else exclude_id,
        ) if include_text else None
        if text_hit is not None:
            pct, sig = text_hit
            signals.append(sig)
            if strength is None:
                strength, confidence = "text", pct
            elif match_level(signals) == "exact":
                # Текст резюме + ещё один признак личности — это уже «точно он».
                confidence = 100
        if strength is None:
            continue
        out.append(DupMatch(
            entity_id=it.entity_id,
            entity_name=it.name,
            is_archived=it.is_archived,
            strength=strength,
            confidence=confidence,
            reasons=[s.label for s in signals if not s.identity] if strength in ("soft", "text")
            else [s.label for s in signals],
            signals=signals,
        ))
    return out


async def scan_org_pairs(
    db: AsyncSession,
    org_id: Optional[int],
    *,
    archived_only: bool = False,
) -> Tuple[List[CandidateKeys], Dict[int, List[DupMatch]]]:
    """Пере-скан всей организации: для каждого кандидата — его совпадения.

    Пары отбираются по общим ключам-блокировкам (:func:`identity_block_keys`), а
    решение по каждой паре принимает :func:`compare_key_sets` — то же правило, что
    у детекта на создании. Раньше пере-скан сверял ФИО точной строкой и поэтому
    находил не то же, что баннер.
    """
    items = await load_candidate_keys(db, org_id, archived_only=archived_only)
    freq = telegram_name_frequency(items)
    by_id = {it.entity_id: it for it in items}

    buckets: Dict[str, List[int]] = {}
    for it in items:
        it.keys = filter_common_telegram(it.keys, freq)
        for k in identity_block_keys(it.keys):
            buckets.setdefault(k, []).append(it.entity_id)

    checked: Set[Tuple[int, int]] = set()
    matches: Dict[int, List[DupMatch]] = {}
    for ids in buckets.values():
        if len(ids) < 2:
            continue
        for i, a_id in enumerate(ids):
            for b_id in ids[i + 1:]:
                if a_id == b_id:
                    continue
                pair = (a_id, b_id) if a_id < b_id else (b_id, a_id)
                if pair in checked:
                    continue
                checked.add(pair)
                a, b = by_id[a_id], by_id[b_id]
                strength, confidence, signals = compare_key_sets(a.keys, b.keys)
                if strength is None:
                    continue
                matches.setdefault(a_id, []).append(DupMatch(
                    entity_id=b_id, entity_name=b.name, is_archived=b.is_archived,
                    strength=strength, confidence=confidence,
                    reasons=[s.label for s in signals], signals=signals,
                ))
                matches.setdefault(b_id, []).append(DupMatch(
                    entity_id=a_id, entity_name=a.name, is_archived=a.is_archived,
                    strength=strength, confidence=confidence,
                    reasons=[s.label for s in signals], signals=signals,
                ))
    for lst in matches.values():
        lst.sort(key=lambda m: (-m.confidence, -m.entity_id))
    return items, matches


# Порядок выбора «того самого» совпадения для флага на карточке. Телефон стоит
# НИЖЕ мягкого тира сознательно (так было и в прежнем detect_archived_duplicate):
# один номер бывает общим — родственники, рабочий телефон, — а мягкий флаг уже
# означает совпадение нескольких независимых признаков.
BEST_MATCH_ORDER: Tuple[str, ...] = ("source", "email", "telegram", "name", "soft", "phone", "text")


def best_match(
    matches: Sequence[DupMatch], order: Sequence[str] = BEST_MATCH_ORDER,
) -> Optional[DupMatch]:
    """Лучшее совпадение: по тиру (см. :data:`BEST_MATCH_ORDER`), внутри тира —
    первое в порядке выдачи (id DESC)."""
    # Сначала «точные» (совпало ≥2 признака), и только потом по тиру: иначе
    # баннер мог показать одиночное совпадение почты, когда рядом есть анкета,
    # совпавшая и по почте, и по телефону.
    for pool in ([m for m in matches if m.level == "exact"], list(matches)):
        for s in order:
            hit = next((m for m in pool if m.strength == s), None)
            if hit is not None:
                return hit
    return None


__all__ = [
    "CandidateKeys", "IDENTITY_ORDER", "SIGNAL_LABELS",
    "compare_key_sets", "identity_block_keys", "keys_of_entity",
    "load_candidate_keys", "telegram_name_frequency", "filter_common_telegram",
    "match_entities", "scan_org_pairs", "best_match", "_dismissed_ids",
]
