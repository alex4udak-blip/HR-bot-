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


import pytest
from api.models.database import Entity, EntityType, Organization


class TestDetectResumeTextTwin:
    @pytest.mark.asyncio
    async def test_flags_near_identical_resume(self, db_session):
        from api.services.resume_text_twin import detect_resume_text_twin
        org = Organization(name="TwinOrg", slug="twin-org")
        db_session.add(org)
        await db_session.flush()
        text = {"about": "Разрабатывал микросервисы на python внедрял ci cd вёл код ревью команды разработки продукта"}
        a = Entity(org_id=org.id, type=EntityType.candidate, name="Иван Иванов", extra_data=text)
        db_session.add(a)
        await db_session.flush()
        b = Entity(org_id=org.id, type=EntityType.candidate, name="Пётр Петров",
                   extra_data={"about": text["about"]})
        db_session.add(b)
        await db_session.flush()

        twin_id, sim = await detect_resume_text_twin(db_session, b)
        assert twin_id == a.id
        assert sim >= 0.8
        meta = (b.extra_data or {}).get("text_twin")
        assert meta and meta["twin_id"] == a.id

    @pytest.mark.asyncio
    async def test_no_flag_for_unique_text(self, db_session):
        from api.services.resume_text_twin import detect_resume_text_twin
        org = Organization(name="UniqOrg", slug="uniq-org")
        db_session.add(org)
        await db_session.flush()
        a = Entity(org_id=org.id, type=EntityType.candidate, name="A A",
                   extra_data={"about": "совершенно уникальный текст про дизайн интерфейсов и типографику"})
        db_session.add(a)
        await db_session.flush()
        b = Entity(org_id=org.id, type=EntityType.candidate, name="B B",
                   extra_data={"about": "другой опыт в бухгалтерии налоговой отчётности и аудите предприятий"})
        db_session.add(b)
        await db_session.flush()
        twin_id, sim = await detect_resume_text_twin(db_session, b)
        assert twin_id is None
