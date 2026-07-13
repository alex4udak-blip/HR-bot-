"""Чистые функции сборки ClickUp-импорта: ключи, группировка, прохождения.

Один реальный человек в ClickUp-выгрузке лежит в нескольких строках (разные
вакансии/рекрутёры/анкеты). Эти функции группируют строки по человеку (по
сильному ключу: hh-URL / email / телефон) и собирают из каждой строки
«прохождение». Без I/O и без БД — всё юнит-тестируется (tests/test_clickup_import.py).
"""
import re
from typing import Optional, Set, List, Dict, Any
from collections import defaultdict


def normalize_phone(value: str) -> str:
    """Телефон → последние 10 цифр (сравнимый ключ). Короче 10 → пусто (не ключ)."""
    digits = re.sub(r"\D", "", value or "")
    return digits[-10:] if len(digits) >= 10 else ""


_HH_RE = re.compile(r"(hh\.ru|rabota\.by)/resume/([0-9a-z]+)", re.IGNORECASE)


def normalize_hh_url(value: str) -> Optional[str]:
    """hh/rabota резюме-URL → канон 'host/resume/id' (без query, lowercase)."""
    if not value:
        return None
    m = _HH_RE.search(value)
    if not m:
        return None
    return f"{m.group(1).lower()}/resume/{m.group(2).lower()}"


def clean_recruiter(folder: str) -> str:
    """'Sandbox - Мария' → 'Мария'. Без префикса — как есть."""
    folder = (folder or "").strip()
    if " - " in folder:
        folder = folder.split(" - ", 1)[1].strip()
    return folder


def row_strong_keys(email: str, phone: str, hh: Optional[str]) -> Set[str]:
    """Сильные ключи строки (может быть несколько). Пусто → только ФИО (не склеиваем)."""
    keys: Set[str] = set()
    e = (email or "").strip().lower()
    if e:
        keys.add(f"email:{e}")
    p = normalize_phone(phone)
    if p:
        keys.add(f"phone:{p}")
    h = normalize_hh_url(hh or "")
    if h:
        keys.add(f"hh:{h}")
    return keys


def group_rows_by_person(rows: List[Dict[str, Any]], key_fn) -> List[List[Dict[str, Any]]]:
    """Union-find по сильным ключам. Строки без ключей → каждая своей группой."""
    parent: Dict[str, str] = {}

    def find(k: str) -> str:
        parent.setdefault(k, k)
        while parent[k] != k:
            parent[k] = parent[parent[k]]
            k = parent[k]
        return k

    def union(a: str, b: str) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    row_keys = [key_fn(r) for r in rows]
    for keys in row_keys:
        kl = list(keys)
        for k in kl[1:]:
            union(kl[0], k)

    groups: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    singleton = 0
    for row, keys in zip(rows, row_keys):
        if keys:
            gid = find(next(iter(sorted(keys))))
        else:
            gid = f"__single_{singleton}"
            singleton += 1
        groups[gid].append(row)
    return list(groups.values())


def build_participation(row: Dict[str, Any], cf_headers: List[str]) -> Dict[str, Any]:
    """Одна строка ClickUp → одно прохождение (вакансия/рекрутёр/статус/анкета)."""
    anketa: List[Dict[str, str]] = []
    for h in cf_headers:
        val = (row.get(h) or "").strip()
        if not val:
            continue
        q = h[3:].strip() if h.lower().startswith("cf:") else h
        anketa.append({"question": q, "answer": val})
    recruiter = clean_recruiter(row.get("funnel_folder", "")) or (row.get("assignees", "") or "").strip()
    return {
        "vacancy_title": (row.get("funnel_list", "") or "").strip(),
        "recruiter": recruiter,
        "status": (row.get("status", "") or "").strip(),
        "anketa": anketa,
        "date": (row.get("date_created", "") or "").strip() or None,
        "task_id": (row.get("task_id", "") or "").strip() or None,
        "url": (row.get("url", "") or "").strip() or None,
    }


def _dedup_twin_participations(parts: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Близнецы (одна вакансия + один рекрутёр) → одно прохождение, анкеты объединены."""
    by_key: Dict[tuple, Dict[str, Any]] = {}
    for p in parts:
        key = (p["vacancy_title"].lower(), p["recruiter"].lower())
        if key not in by_key:
            by_key[key] = {**p, "anketa": list(p["anketa"])}
            continue
        existing = by_key[key]
        seen_q = {a["question"] for a in existing["anketa"]}
        for a in p["anketa"]:
            if a["question"] not in seen_q:
                existing["anketa"].append(a)
                seen_q.add(a["question"])
    return list(by_key.values())


def _longest(values: List[str]) -> str:
    vals = [v for v in values if v]
    return max(vals, key=len) if vals else ""


def assemble_person(group: List[Dict[str, Any]], cf_headers: List[str]) -> Dict[str, Any]:
    """Группа строк одного человека → payload одной архивной карточки с участиями."""
    names = [(r.get("name", "") or "").strip() for r in group]
    emails = {(r.get("email", "") or "").strip().lower() for r in group if (r.get("email") or "").strip()}
    phones = {(r.get("phone", "") or "").strip() for r in group if (r.get("phone") or "").strip()}
    tgs = {(r.get("telegram", "") or "").strip().lstrip("@").lower()
           for r in group if (r.get("telegram") or "").strip()}
    participations = _dedup_twin_participations([build_participation(r, cf_headers) for r in group])
    primary = participations[0] if participations else {}
    return {
        "name": _longest(names),
        "email": (sorted(emails)[0] if emails else None),
        "phone": (sorted(phones)[0] if phones else None),
        "phones": sorted(phones),
        "telegram_usernames": sorted(tgs),
        "position": primary.get("vacancy_title") or None,
        "extra_data": {"participations": participations, "import_source": "clickup"},
    }


_HH_COL_HINTS = ("резюме hh", "ссылку на свое резюме", "резюме из hh")


def extract_hh_from_row(row: Dict[str, Any]) -> Optional[str]:
    """Ищет hh/rabota резюме-URL в известных cf:-колонках и в description."""
    for col, val in row.items():
        cl = col.lower()
        if any(h in cl for h in _HH_COL_HINTS) or cl == "cf:резюме":
            got = normalize_hh_url(val or "")
            if got:
                return got
    return normalize_hh_url(row.get("description", "") or "")


_EMAIL_RE = re.compile(r"[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}", re.IGNORECASE)
_EMAIL_COL_HINTS = ("почт", "email", "e-mail", "mail")


def extract_email_from_row(row: Dict[str, Any]) -> Optional[str]:
    """Почта из cf:-колонок с намёком на почту (произвольные имена), иначе из description."""
    for col, val in row.items():
        if any(h in col.lower() for h in _EMAIL_COL_HINTS) and isinstance(val, str):
            m = _EMAIL_RE.search(val)
            if m:
                return m.group(0).lower()
    m = _EMAIL_RE.search(row.get("description", "") or "")
    return m.group(0).lower() if m else None


def merge_participations(
    existing: List[Dict[str, Any]], incoming: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    """До-кладываем участия. Идентичность = task_id (если есть), иначе (вакансия, рекрутёр)."""
    def sig(p: Dict[str, Any]):
        return p.get("task_id") or (
            (p.get("vacancy_title") or "").lower(),
            (p.get("recruiter") or "").lower(),
        )

    seen = {sig(p) for p in existing}
    out = list(existing)
    for p in incoming:
        s = sig(p)
        if s not in seen:
            out.append(p)
            seen.add(s)
    return out
