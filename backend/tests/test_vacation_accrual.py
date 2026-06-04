"""
Tests for the vacation accrual calculator.

Business rule (Владимир/Настя): ровно 2 дня отпуска за каждый ПОЛНЫЙ отработанный
месяц, отсчёт от department_start_date («Дата старта работы»), БЕЗ испытательного
срока — начисление идёт с первого месяца.
"""
from datetime import datetime

from dateutil.relativedelta import relativedelta


def _calc_months_ago(months_ago: int) -> int:
    from api.routes.employees import _calculate_vacation_days
    start = datetime.utcnow() - relativedelta(months=months_ago)
    return _calculate_vacation_days(start)


class TestVacationAccrual:
    def test_none_returns_zero(self):
        from api.routes.employees import _calculate_vacation_days
        assert _calculate_vacation_days(None) == 0

    def test_future_start_returns_zero(self):
        from api.routes.employees import _calculate_vacation_days
        future = datetime.utcnow() + relativedelta(months=2)
        assert _calculate_vacation_days(future) == 0

    def test_one_full_month_is_two_days(self):
        assert _calc_months_ago(1) == 2

    def test_no_probation_gate(self):
        # Никакого испытательного срока: уже на втором месяце — 4 дня.
        assert _calc_months_ago(2) == 4

    def test_five_months(self):
        assert _calc_months_ago(5) == 10

    def test_full_year_is_24(self):
        assert _calc_months_ago(12) == 24

    def test_thirteen_months(self):
        assert _calc_months_ago(13) == 26
