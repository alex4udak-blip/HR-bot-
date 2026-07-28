"""Юнит-тесты для строгого поиска по telegram-нику (is_nick_query / telegram_only_conditions).

Чисто функциональные — без БД. Проверяют:
- «@»-запрос детектится как ник-запрос;
- обычные запросы (в т.ч. email с «@» не в начале) — нет;
- telegram_only_conditions даёт ровно одно условие для валидного ника и пусто
  для пустого/бессмысленного запроса.
"""
import pytest

from api.services.search_index import is_nick_query, telegram_only_conditions


@pytest.mark.parametrize(
    "q, expected",
    [
        ("@shblsn", True),
        ("shblsn", False),
        ("  @x", True),
        ("", False),
        ("ivan@mail.ru", False),  # «@» не в начале — это почта, не ник
    ],
)
def test_is_nick_query(q, expected):
    assert is_nick_query(q) is expected


def test_telegram_only_conditions_valid_nick():
    conds = telegram_only_conditions("@shblsn")
    assert len(conds) == 1


def test_telegram_only_conditions_bare_at():
    assert telegram_only_conditions("@") == []


def test_telegram_only_conditions_empty():
    assert telegram_only_conditions("") == []
