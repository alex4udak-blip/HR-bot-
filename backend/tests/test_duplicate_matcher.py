"""Единое ядро дедупа (services/duplicate_matcher) — этап 0 переделки.

Смысл этих тестов: закрепить, что «это тот же человек» решается ОДНИМ правилом.
Раньше баннер «Похожий кандидат», окно сравнения и пере-скан считали по трём
разным шкалам, и по одной паре показывали разные проценты.
"""
import pytest

from api.models.database import Entity, EntityType, EntityStatus, Organization
from api.services.duplicate_matcher import (
    compare_key_sets,
    identity_block_keys,
    keys_of_entity,
    match_entities,
    scan_org_pairs,
    best_match,
)
from api.services.similarity import (
    build_dup_keys, detect_archived_duplicate, find_duplicate_matches, similarity_service,
)


async def _mk(db, org_id, name, **kw):
    e = Entity(org_id=org_id, type=EntityType.candidate, name=name, status=EntityStatus.new, **kw)
    db.add(e)
    await db.flush()
    return e


# ============================================================
# compare_key_sets — единственное место, где решается «тот же человек»
# ============================================================

class TestCompareKeySets:
    def test_exact_email_is_identity_tier(self):
        a = build_dup_keys(name="Иван Иванов", email="dup@gmail.com")
        b = build_dup_keys(name="Пётр Петров", email="dup@gmail.com")
        strength, confidence, signals = compare_key_sets(a, b)
        assert (strength, confidence) == ("email", 100)
        assert any(s.field == "email" and s.identity for s in signals)

    def test_soft_component_does_not_fake_identity_tier(self):
        # Совпали ПОСЛЕДНИЕ 7 цифр (разный код города) + дата рождения. Мягкий
        # сигнал лежит в поле "phone" — но тир обязан остаться soft, а не «phone».
        a = build_dup_keys(name="Сидоров Иван", phone="+7 495 000-11-22",
                           extra_data={"birth_date": "14.05.1990"})
        b = build_dup_keys(name="Петров Александр", phone="+7 916 000-11-22",
                           extra_data={"birth_date": "1990-05-14"})
        strength, confidence, signals = compare_key_sets(a, b)
        assert strength == "soft"
        assert 65 <= confidence < 100
        assert not any(s.identity for s in signals)

    def test_signals_cover_every_matched_field(self):
        a = build_dup_keys(name="Соколов Пётр", email="p.sokolov@gmail.com",
                           phone="+7 910 555-12-34",
                           extra_data={"birth_date": "1997-01-02", "city": "Москва"})
        b = build_dup_keys(name="Cоколов Пётр Игоревич", email="p.sokolov@mail.ru",
                           phone="8 (910) 555 12 34",
                           extra_data={"birth_date": "02.01.1997", "city": "Москва"})
        strength, confidence, signals = compare_key_sets(a, b)
        assert (strength, confidence) == ("email", 100)
        fields = {s.field for s in signals}
        # Один факт — одно поле: «ФИО совпало» не должно приезжать и как name,
        # и как full_name (окно сравнения подсвечивает поле, а не имя правила).
        assert fields == {"email", "name", "phone", "birth_date", "city"}
        assert len(fields) == len(signals)

    def test_different_people_are_not_a_match(self):
        a = build_dup_keys(name="Борисов Кирилл Евгеньевич")
        b = build_dup_keys(name="Сапрыкин Кирилл Евгеньевич")
        assert compare_key_sets(a, b)[0] is None

    def test_block_keys_are_deduplicated(self):
        # «Иванов Иван» даёт одинаковый ключ от фамилии и от имени. Дубль ключа
        # клал кандидата в корзину дважды — он сравнивался сам с собой и всегда
        # «совпадал» (пере-скан из-за этого никогда не снимал устаревшие флаги).
        keys = identity_block_keys(build_dup_keys(name="Иванов Иван"))
        assert len(keys) == len(set(keys))


# ============================================================
# Одна пара — одно число в баннере и в окне сравнения
# ============================================================

@pytest.mark.asyncio
async def test_same_confidence_in_banner_and_compare_window(db_session, organization):
    old = await _mk(db_session, organization.id, "Иван Иванов", email="same@x.com")
    new = await _mk(db_session, organization.id, "Другое Имя", email="same@x.com")
    await db_session.commit()

    await detect_archived_duplicate(db_session, new)
    meta = (new.extra_data or {}).get("hidden_duplicate_meta")
    dups = await similarity_service.detect_duplicates(db=db_session, entity=new)

    card = next(d for d in dups if d.entity_id == old.id)
    # Раньше: баннер «Точное совпадение» (100), карточка — «30%».
    assert meta["confidence"] == card.confidence == 100
    assert meta["strength"] == card.strength == "email"


@pytest.mark.asyncio
async def test_compare_window_exposes_signals_for_highlighting(db_session, organization):
    await _mk(db_session, organization.id, "Соколов Пётр", phone="+7 910 555-12-34",
              extra_data={"city": "Москва"})
    new = await _mk(db_session, organization.id, "Соколов Пётр Игоревич",
                    phone="8 910 5551234", extra_data={"city": "Москва"})
    await db_session.commit()

    dups = await similarity_service.detect_duplicates(db=db_session, entity=new)
    assert dups, "пара по ФИО+телефону обязана попасть в окно сравнения"
    signals = {s.field: s for s in dups[0].signals}
    assert signals["phone"].identity is True
    assert signals["city"].identity is False
    assert dups[0].matched_fields["phone"][0]


# ============================================================
# Текст резюме — подсказка, а не основание слить
# ============================================================

@pytest.mark.asyncio
async def test_text_twin_is_info_tier_only(db_session, organization):
    other = await _mk(db_session, organization.id, "Никита Первый", email="n1@x.com")
    await db_session.flush()
    new = await _mk(
        db_session, organization.id, "Никита Второй", email="n2@x.com",
        extra_data={"text_twin": {"twin_id": other.id, "similarity": 0.93}},
    )
    await db_session.commit()

    # Окно сравнения показывает пару как подсказку…
    dups = await similarity_service.detect_duplicates(db=db_session, entity=new)
    twin = next((d for d in dups if d.entity_id == other.id), None)
    assert twin is not None and twin.strength == "text"
    assert twin.confidence == 93

    # …а баннер слияния по одному тексту не поднимается: у разных людей бывают
    # анкеты по одному шаблону (реальный кейс с тремя «Никитами»).
    assert await detect_archived_duplicate(db_session, new) is None
    matches = await find_duplicate_matches(
        db_session, organization.id, keys_of_entity(new), exclude_id=new.id,
    )
    assert all(m.strength != "text" for m in matches)


# ============================================================
# Пере-скан видит то же, что детект на создании
# ============================================================

@pytest.mark.asyncio
async def test_rescan_matches_patronymic_like_detector(db_session, organization):
    # Прежний пере-скан сверял ФИО ТОЧНОЙ строкой и эту пару не находил, хотя
    # детект-на-создании считает её дублем.
    a = await _mk(db_session, organization.id, "Векленко Кирилл Дмитриевич")
    b = await _mk(db_session, organization.id, "Векленко Кирилл")
    await db_session.commit()

    _items, pairs = await scan_org_pairs(db_session, organization.id)
    assert {m.entity_id for m in pairs.get(b.id, [])} == {a.id}
    assert await detect_archived_duplicate(db_session, b) == a.id


@pytest.mark.asyncio
async def test_scan_never_pairs_entity_with_itself(db_session, organization):
    await _mk(db_session, organization.id, "Иванов Иван", email="stale-a@x.com")
    await _mk(db_session, organization.id, "Петров Пётр", email="stale-b@x.com")
    await db_session.commit()

    _items, pairs = await scan_org_pairs(db_session, organization.id)
    for owner_id, ms in pairs.items():
        assert all(m.entity_id != owner_id for m in ms)


# ============================================================
# Границы: организация, dismissed, приоритет тира
# ============================================================

@pytest.mark.asyncio
async def test_match_entities_respects_org_and_dismissed(db_session, organization, second_organization):
    await _mk(db_session, second_organization.id, "Чужой", email="cross@x.com")
    mine = await _mk(db_session, organization.id, "Свой", email="cross@x.com")
    await db_session.flush()
    probe = await _mk(db_session, organization.id, "Новый", email="cross@x.com")
    await db_session.commit()

    keys = keys_of_entity(probe)
    matches = await match_entities(db_session, organization.id, keys, exclude_id=probe.id)
    assert {m.entity_id for m in matches} == {mine.id}

    matches = await match_entities(
        db_session, organization.id, keys, exclude_id=probe.id, dismissed={mine.id},
    )
    assert matches == []


@pytest.mark.asyncio
async def test_best_match_prefers_strong_over_soft_over_phone(db_session, organization):
    # Телефон намеренно НИЖЕ мягкого тира: один номер бывает общим (родственники,
    # рабочий), а мягкий флаг — это уже несколько совпавших признаков.
    phone_only = await _mk(db_session, organization.id, "Телефонов Тимур", phone="+7 900 111-22-33")
    await db_session.flush()
    strong = await _mk(db_session, organization.id, "Сильнов Семён", email="best@x.com")
    await db_session.flush()
    probe = await _mk(db_session, organization.id, "Проверкин Пётр",
                      email="best@x.com", phone="+7 900 111-22-33")
    await db_session.commit()

    matches = await match_entities(
        db_session, organization.id, keys_of_entity(probe), exclude_id=probe.id,
    )
    assert {m.entity_id for m in matches} == {phone_only.id, strong.id}
    assert best_match(matches).entity_id == strong.id
