"""Unit tests for the Level-2 soft-identity duplicate scorer (pure functions)."""
from api.services.similarity import (
    normalize_birth_date,
    age_from_birth,
    SOFT_WEIGHTS,
    SOFT_THRESHOLD,
)


class TestNormalizeBirthDate:
    def test_iso_passthrough(self):
        assert normalize_birth_date("1990-05-14") == "1990-05-14"

    def test_dotted_ru_format(self):
        assert normalize_birth_date("14.05.1990") == "1990-05-14"

    def test_slashed_format(self):
        assert normalize_birth_date("14/05/1990") == "1990-05-14"

    def test_year_month_only_returns_none(self):
        # Not a full date -> not usable as an exact-DOB key.
        assert normalize_birth_date("1990-05") is None

    def test_garbage_returns_none(self):
        assert normalize_birth_date("не указано") is None
        assert normalize_birth_date("") is None
        assert normalize_birth_date(None) is None


class TestAgeFromBirth:
    def test_age_from_iso(self):
        # Reference date passed explicitly to keep the test deterministic.
        assert age_from_birth("1990-05-14", today="2026-07-17") == 36

    def test_age_before_birthday_this_year(self):
        assert age_from_birth("1990-12-31", today="2026-07-17") == 35

    def test_invalid_returns_none(self):
        assert age_from_birth("garbage", today="2026-07-17") is None


class TestConstants:
    def test_weights_present(self):
        for key in ("last_name", "first_name", "dob_exact", "age_pm1",
                    "phone7", "email_local", "city"):
            assert key in SOFT_WEIGHTS
    def test_threshold_is_int(self):
        assert isinstance(SOFT_THRESHOLD, int)


from api.services.similarity import name_part_match


class TestNamePartMatch:
    def test_exact_ru(self):
        assert name_part_match("Александр", "Александр") is True

    def test_translit(self):
        assert name_part_match("Александр", "Aleksandr") is True

    def test_one_typo(self):
        # Deliberate single-char typo still matches.
        assert name_part_match("Петров", "Петорв") is True
        assert name_part_match("Aleksandr", "Alexsandr") is True

    def test_diminutive(self):
        assert name_part_match("Александр", "Саша") is True
        assert name_part_match("Aleksandr", "Sasha") is True

    def test_initial_abbreviation(self):
        # "А." abbreviates "Александр".
        assert name_part_match("Александр", "А.") is True

    def test_different_names_do_not_match(self):
        assert name_part_match("Александр", "Дмитрий") is False
        assert name_part_match("Петров", "Сидоров") is False

    def test_empty_is_false(self):
        assert name_part_match("", "Александр") is False
        assert name_part_match("Александр", "") is False


from api.services.similarity import score_soft_identity, SoftScore


def _keys(**kw):
    """Build a soft-key dict matching build_dup_keys' soft-key contract."""
    base = {
        "first_names": set(), "last_names": set(),
        "birth_norm": None, "age": None,
        "phones7": set(), "email_locals": set(), "cities": set(),
    }
    base.update(kw)
    return base


class TestScoreSoftIdentity:
    def test_lastname_plus_firstname_flags(self):
        a = _keys(first_names={"александр"}, last_names={"петров"})
        b = _keys(first_names={"саша"}, last_names={"petrov"})
        r = score_soft_identity(a, b)
        assert r.confidence == 70  # 45 + 25
        assert r.components >= 2
        assert r.is_flag is True

    def test_firstname_plus_dob_flags(self):
        a = _keys(first_names={"александр"}, birth_norm="1990-05-14")
        b = _keys(first_names={"aleksandr"}, birth_norm="1990-05-14")
        r = score_soft_identity(a, b)
        assert r.confidence == 65  # 25 + 40
        assert r.is_flag is True

    def test_dob_alone_never_flags(self):
        a = _keys(birth_norm="1990-05-14")
        b = _keys(birth_norm="1990-05-14")
        r = score_soft_identity(a, b)
        assert r.components == 1
        assert r.is_flag is False  # single component, below min-components

    def test_common_first_name_alone_never_flags(self):
        a = _keys(first_names={"александр"})
        b = _keys(first_names={"александр"})
        r = score_soft_identity(a, b)
        assert r.confidence == 25
        assert r.is_flag is False

    def test_phone7_plus_firstname_flags(self):
        a = _keys(first_names={"иван"}, phones7={"1234567"})
        b = _keys(first_names={"ivan"}, phones7={"1234567"})
        r = score_soft_identity(a, b)
        assert r.confidence == 60  # 35 + 25
        assert r.is_flag is True

    def test_email_local_plus_dob_flags(self):
        a = _keys(email_locals={"ivan.petrov"}, birth_norm="1988-01-02")
        b = _keys(email_locals={"ivan.petrov"}, birth_norm="1988-01-02")
        r = score_soft_identity(a, b)
        assert r.confidence == 75  # 35 + 40
        assert r.is_flag is True

    def test_reasons_are_human_readable(self):
        a = _keys(first_names={"александр"}, last_names={"петров"})
        b = _keys(first_names={"саша"}, last_names={"petrov"})
        r = score_soft_identity(a, b)
        assert any("амили" in reason.lower() for reason in r.reasons)  # «Фамилия ...»

    def test_confidence_capped_at_100(self):
        a = _keys(first_names={"иван"}, last_names={"петров"},
                  birth_norm="1990-05-14", phones7={"1234567"},
                  email_locals={"ivan"}, cities={"минск"})
        r = score_soft_identity(a, a)  # identical keys both sides -> all signals hit
        assert r.confidence == 100  # 45+25+40+35+35+8 = 188, capped at 100
