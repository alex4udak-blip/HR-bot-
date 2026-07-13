"""Юнит-тесты чистых функций ClickUp-combine импорта."""
from api.services.clickup_import import (
    normalize_phone,
    normalize_hh_url,
    clean_recruiter,
    row_strong_keys,
    group_rows_by_person,
    build_participation,
    assemble_person,
    extract_hh_from_row,
    extract_email_from_row,
    merge_participations,
)


# ── Task 1: ключи и нормализация ──

def test_normalize_phone_last10():
    assert normalize_phone("+7 915 167 29 74") == "9151672974"
    assert normalize_phone("8(915)167-29-74") == "9151672974"
    assert normalize_phone("123") == ""  # слишком коротко → не ключ


def test_normalize_hh_url_strips_query():
    a = normalize_hh_url("https://hh.ru/resume/ABC123?from=share&t=1")
    assert a == "hh.ru/resume/abc123"
    assert normalize_hh_url("нет ссылки") is None


def test_clean_recruiter_strips_prefix():
    assert clean_recruiter("Sandbox - Мария") == "Мария"
    assert clean_recruiter("Эльвира") == "Эльвира"
    assert clean_recruiter("") == ""


def test_row_strong_keys():
    keys = row_strong_keys("IVAN@x.io", "+7 915 167 29 74", "https://hh.ru/resume/ABC?x=1")
    assert "email:ivan@x.io" in keys
    assert "phone:9151672974" in keys
    assert "hh:hh.ru/resume/abc" in keys


def test_row_strong_keys_name_only_is_empty():
    assert row_strong_keys("", "", None) == set()


# ── Task 2: группировка ──

def _key_fn(row):
    return row_strong_keys(row.get("email", ""), row.get("phone", ""), row.get("hh"))


def test_group_merges_by_shared_phone():
    rows = [
        {"name": "Панасик", "phone": "+375 25 918 24 41", "funnel_list": "Android dev"},
        {"name": "Панасик", "phone": "+375 25 918 24 41", "funnel_list": "Unity"},
        {"name": "Другой", "phone": "+7 900 000 00 00", "funnel_list": "Unity dev"},
    ]
    groups = group_rows_by_person(rows, _key_fn)
    sizes = sorted(len(g) for g in groups)
    assert sizes == [1, 2]


def test_group_transitive_email_then_phone():
    rows = [
        {"name": "A", "email": "x@x.io"},
        {"name": "B", "email": "x@x.io", "phone": "+7 915 167 29 74"},
        {"name": "C", "phone": "89151672974"},
    ]
    groups = group_rows_by_person(rows, _key_fn)
    assert len(groups) == 1 and len(groups[0]) == 3


def test_group_name_only_rows_stay_separate():
    rows = [
        {"name": "Ким Евгений"},
        {"name": "Ким Евгений"},
    ]
    groups = group_rows_by_person(rows, _key_fn)
    assert len(groups) == 2


# ── Task 3: сборка прохождения и человека ──

def test_build_participation():
    row = {
        "funnel_list": "Android dev", "funnel_folder": "Sandbox - Мария",
        "status": "собес (1): нет", "date_created": "2026-07-08 19:17:06",
        "task_id": "86camy7yj", "url": "https://app.clickup.com/t/86camy7yj",
        "cf:Telegram": "@itegin", "cf:Источник": "hh", "cf:Пусто": "",
    }
    cf_headers = ["cf:Telegram", "cf:Источник", "cf:Пусто"]
    p = build_participation(row, cf_headers)
    assert p["vacancy_title"] == "Android dev"
    assert p["recruiter"] == "Мария"
    assert p["status"] == "собес (1): нет"
    assert p["task_id"] == "86camy7yj"
    assert {"question": "Telegram", "answer": "@itegin"} in p["anketa"]
    assert all(a["answer"] for a in p["anketa"])


def test_assemble_person_dedups_twin_passes():
    group = [
        {"name": "Панасик Т", "phone": "+375259182441", "funnel_list": "Android dev",
         "funnel_folder": "Sandbox - Мария", "status": "анкета: нет", "cf:A": "1"},
        {"name": "Панасик Т", "phone": "+375259182441", "funnel_list": "Android dev",
         "funnel_folder": "Sandbox - Мария", "status": "анкета: нет", "cf:B": "2"},
        {"name": "Панасик Т", "phone": "+375259182441", "funnel_list": "Unity",
         "funnel_folder": "Sandbox - Эльвира", "status": "анкета: нет", "cf:A": "3"},
    ]
    person = assemble_person(group, cf_headers=["cf:A", "cf:B"])
    parts = person["extra_data"]["participations"]
    assert len(parts) == 2
    android = next(p for p in parts if p["vacancy_title"] == "Android dev")
    qs = {a["question"] for a in android["anketa"]}
    assert qs == {"A", "B"}
    assert person["phone"] == "+375259182441"
    assert person["name"] == "Панасик Т"


# ── Task 4/5: hh-экстрактор + идемпотентное слияние участий ──

def test_extract_hh_from_row():
    row = {"cf:Резюме hh": "https://hh.ru/resume/ABC?x=1", "name": "X"}
    assert extract_hh_from_row(row) == "hh.ru/resume/abc"
    assert extract_hh_from_row({"description": "смотри https://hh.ru/resume/ZZZ"}) == "hh.ru/resume/zzz"
    assert extract_hh_from_row({"name": "нет"}) is None


def test_extract_email_from_row():
    row = {"cf:Укажи, пожалуйста, актуальную почту": "IVAN@X.io", "name": "X"}
    assert extract_email_from_row(row) == "ivan@x.io"
    assert extract_email_from_row({"description": "почта a.b@mail.ru тут"}) == "a.b@mail.ru"
    assert extract_email_from_row({"name": "нет почты"}) is None


def test_merge_participations_idempotent():
    existing = [{"vacancy_title": "Android dev", "recruiter": "Мария", "status": "x",
                 "anketa": [], "date": None, "task_id": "T1", "url": None}]
    incoming = [
        {"vacancy_title": "Android dev", "recruiter": "Мария", "status": "x",
         "anketa": [], "date": None, "task_id": "T1", "url": None},
        {"vacancy_title": "Unity", "recruiter": "Эльвира", "status": "y",
         "anketa": [], "date": None, "task_id": "T2", "url": None},
    ]
    merged = merge_participations(existing, incoming)
    assert len(merged) == 2
    assert {p["task_id"] for p in merged} == {"T1", "T2"}
