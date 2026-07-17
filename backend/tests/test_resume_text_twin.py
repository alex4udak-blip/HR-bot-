"""Unit tests for the resume-text near-duplicate ('copy-paste') detector."""
from api.services.resume_text_twin import (
    normalize_resume_text,
    resume_text_blob,
    text_shingles,
    jaccard_similarity,
)


class TestNormalize:
    def test_lowercases_and_collapses_ws(self):
        assert normalize_resume_text("Разрабатывал   API\n\nна Python") == \
            "разрабатывал api на python"

    def test_strips_punctuation_and_digits(self):
        assert normalize_resume_text("2019-2021: Python, C++!") == "python c"


class TestBlob:
    def test_blob_joins_about_and_experience(self):
        extra = {
            "about": "Опытный разработчик",
            "experience": [
                {"description": "Писал сервисы", "achievements": ["ускорил сборку"]},
                {"description": "Вёл команду"},
            ],
        }
        blob = resume_text_blob(extra)
        assert "опытный разработчик" in blob
        assert "писал сервисы" in blob
        assert "ускорил сборку" in blob
        assert "вёл команду" in blob


class TestSimilarity:
    def test_identical_text_is_1(self):
        t = normalize_resume_text("писал сервисы на python и вёл команду разработки")
        s = text_shingles(t, n=3)
        assert jaccard_similarity(s, s) == 1.0

    def test_disjoint_text_is_0(self):
        a = text_shingles(normalize_resume_text("один два три четыре пять"), n=3)
        b = text_shingles(normalize_resume_text("шесть семь восемь девять десять"), n=3)
        assert jaccard_similarity(a, b) == 0.0

    def test_near_duplicate_above_threshold(self):
        base = "разрабатывал микросервисы на python внедрял ci cd вёл код ревью команды"
        copy = "разрабатывал микросервисы на python внедрял ci cd вёл ревью кода команды"
        a = text_shingles(normalize_resume_text(base), n=3)
        b = text_shingles(normalize_resume_text(copy), n=3)
        assert jaccard_similarity(a, b) >= 0.5

    def test_empty_shingles_is_0(self):
        assert jaccard_similarity(set(), set()) == 0.0
