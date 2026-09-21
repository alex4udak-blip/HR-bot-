"""Пополевое слияние дублей (решение владельца 21.09.2026).

Раньше «Объединить» молча оставлял у выжившей карточки её имя, должность,
компанию, основные почту и телефон — значения второй анкеты пропадали. Теперь
рекрутёр выбирает по каждому полю, чьё значение останется. Клиент присылает
только сторону, значения берутся на сервере.
"""
from datetime import datetime

import pytest

from api.models.database import Entity, EntityStatus, EntityType
from api.services.auth import create_access_token
from api.services.similarity import (
    MERGE_FIELD_KEYS, similarity_service, validate_field_choices,
)


def _h(u):
    return {"Authorization": f"Bearer {create_access_token(data={'sub': str(u.id)})}"}


async def _pair(db, org):
    """Выжившая (новая) и вторая (старая) анкеты одного человека с РАЗНЫМИ полями."""
    target = Entity(
        org_id=org.id, type=EntityType.candidate, status=EntityStatus.new,
        name="Гончарова Алиса", position="Product Designer", company="Wildberries",
        email="alisa.new@gmail.com", phone="+7 903 118-44-01",
        telegram_usernames=["alisa_new"],
        expected_salary_min=200000, expected_salary_max=250000, expected_salary_currency="RUB",
        extra_data={"city": "Москва", "birth_date": "1994-03-12"},
        created_at=datetime.utcnow(),
    )
    source = Entity(
        org_id=org.id, type=EntityType.candidate, status=EntityStatus.rejected,
        name="Гончарова Алиса Игоревна", position="UX-дизайнер", company="Ozon",
        email="alisa.old@mail.ru", phone="+7 903 118-44-01",
        telegram_usernames=["alisa_old"],
        expected_salary_min=150000, expected_salary_max=300000, expected_salary_currency="RUB",
        extra_data={"city": "Санкт-Петербург", "birth_date": "1994-03-12", "source": "hh.ru"},
        created_at=datetime.utcnow(),
    )
    db.add_all([target, source])
    await db.commit()
    await db.refresh(target)
    await db.refresh(source)
    return target, source


class TestValidateFieldChoices:
    def test_unknown_field_rejected(self):
        with pytest.raises(ValueError):
            validate_field_choices({"password": "source"})

    def test_unknown_side_rejected(self):
        with pytest.raises(ValueError):
            validate_field_choices({"name": "both"})

    def test_empty_is_ok(self):
        assert validate_field_choices(None) == {}

    def test_all_known_fields_accepted(self):
        assert validate_field_choices({k: "source" for k in MERGE_FIELD_KEYS})


@pytest.mark.asyncio
async def test_chosen_source_values_land_on_survivor(db_session, organization):
    target, source = await _pair(db_session, organization)

    merged = await similarity_service.merge_entities(
        db=db_session, source_entity=source, target_entity=target,
        field_choices={
            "name": "source", "position": "source", "company": "source",
            "email": "source", "city": "source", "telegram": "source",
        },
    )

    assert merged.name == "Гончарова Алиса Игоревна"
    assert merged.position == "UX-дизайнер"
    assert merged.company == "Ozon"
    assert merged.email == "alisa.old@mail.ru"
    assert merged.extra_data["city"] == "Санкт-Петербург"
    assert merged.telegram_usernames[0] == "alisa_old"


@pytest.mark.asyncio
async def test_nothing_is_lost_when_primary_contact_switches(db_session, organization):
    """Взяли почту справа — левая почта не исчезает, а остаётся в списке контактов."""
    target, source = await _pair(db_session, organization)

    merged = await similarity_service.merge_entities(
        db=db_session, source_entity=source, target_entity=target,
        field_choices={"email": "source", "telegram": "source"},
    )

    assert merged.email == "alisa.old@mail.ru"
    assert "alisa.new@gmail.com" in (merged.emails or [])
    assert "alisa_new" in merged.telegram_usernames


@pytest.mark.asyncio
async def test_keep_left_means_exactly_left(db_session, organization):
    """«Оставить слева» — ровно значение выжившей. Общая часть слияния расширяет
    диапазон зарплаты (150–300) и перемешивает telegram — выбор это отменяет."""
    target, source = await _pair(db_session, organization)

    merged = await similarity_service.merge_entities(
        db=db_session, source_entity=source, target_entity=target,
        field_choices={"salary": "target", "telegram": "target", "name": "target"},
    )

    assert (merged.expected_salary_min, merged.expected_salary_max) == (200000, 250000)
    assert merged.telegram_usernames[0] == "alisa_new"
    assert merged.name == "Гончарова Алиса"


@pytest.mark.asyncio
async def test_salary_from_source_replaces_widest_range(db_session, organization):
    target, source = await _pair(db_session, organization)

    merged = await similarity_service.merge_entities(
        db=db_session, source_entity=source, target_entity=target,
        field_choices={"salary": "source"},
    )

    assert (merged.expected_salary_min, merged.expected_salary_max) == (150000, 300000)


@pytest.mark.asyncio
async def test_empty_source_value_does_not_wipe_filled_field(db_session, organization):
    """Выбор «справа» при пустой правой стороне не должен обнулять поле."""
    target, source = await _pair(db_session, organization)
    source.company = None
    await db_session.commit()

    merged = await similarity_service.merge_entities(
        db=db_session, source_entity=source, target_entity=target,
        field_choices={"company": "source"},
    )

    assert merged.company == "Wildberries"


@pytest.mark.asyncio
async def test_empty_survivor_field_filled_from_source(db_session, organization):
    """Пустая должность у выжившей раньше так и оставалась пустой; теперь рекрутёр
    берёт её справа."""
    target, source = await _pair(db_session, organization)
    target.position = None
    await db_session.commit()

    merged = await similarity_service.merge_entities(
        db=db_session, source_entity=source, target_entity=target,
        field_choices={"position": "source"},
    )

    assert merged.position == "UX-дизайнер"


@pytest.mark.asyncio
async def test_no_choices_keeps_old_behaviour(db_session, organization):
    target, source = await _pair(db_session, organization)

    merged = await similarity_service.merge_entities(
        db=db_session, source_entity=source, target_entity=target,
    )

    assert merged.name == "Гончарова Алиса"
    assert merged.email == "alisa.new@gmail.com"
    assert merged.extra_data["city"] == "Москва"


@pytest.mark.asyncio
async def test_choices_recorded_in_merge_history(db_session, organization):
    """Выбор пишется в контейнер влитой анкеты — видно, откуда у карточки значение."""
    target, source = await _pair(db_session, organization)

    merged = await similarity_service.merge_entities(
        db=db_session, source_entity=source, target_entity=target,
        field_choices={"name": "source", "email": "target"},
    )

    container = merged.extra_data["merged_from"][-1]
    assert container["field_choices"] == {"name": "source", "email": "target"}


@pytest.mark.asyncio
async def test_endpoint_applies_choices(client, db_session, organization, admin_user, org_owner):
    target, source = await _pair(db_session, organization)

    r = await client.post(
        f"/api/entities/{target.id}/merge-shadow",
        json={"duplicate_id": source.id, "field_choices": {"company": "source"}},
        headers=_h(admin_user),
    )
    assert r.status_code == 200, r.text

    await db_session.refresh(target)
    assert target.company == "Ozon"


@pytest.mark.asyncio
async def test_endpoint_rejects_bad_choice_without_merging(client, db_session, organization, admin_user, org_owner):
    """Плохой запрос — 422, и обе карточки на месте: проверка идёт ДО слияния."""
    target, source = await _pair(db_session, organization)

    r = await client.post(
        f"/api/entities/{target.id}/merge-shadow",
        json={"duplicate_id": source.id, "field_choices": {"password": "source"}},
        headers=_h(admin_user),
    )
    assert r.status_code == 422, r.text

    assert await db_session.get(Entity, source.id) is not None
