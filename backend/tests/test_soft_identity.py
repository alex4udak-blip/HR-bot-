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
