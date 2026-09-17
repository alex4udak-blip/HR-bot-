"""Наполнение ЛОКАЛЬНОЙ базы парами кандидатов-дублей — чтобы было что проверять.

Создаёт по паре на КАЖДЫЙ тир единого матчера (services/duplicate_matcher):
точная почта, телефон в разном формате, ФИО с отчеством и транслитом, та же
ссылка на резюме, личный telegram, мягкий тир (разное ФИО, но те же 7 цифр
телефона и дата рождения), совпавший текст резюме и архивный дубль.

У «старой» анкеты каждой пары заполнены статус/причина отказа/история этапов и
резюме — чтобы окно сравнения было не пустым. Помечены маркером
``extra_data.demo_dup_fixture`` и удаляются одной командой:

    cd backend && set -a && . ./dev.env && set +a && .venv/bin/python seed_duplicates_demo.py
    cd backend && set -a && . ./dev.env && set +a && .venv/bin/python seed_duplicates_demo.py --purge

Идемпотентен: повторный запуск сначала сносит прошлую партию. Не для прода —
отказывается работать, если DATABASE_URL не смотрит на localhost.
"""
import asyncio
import os
import sys
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker

from api.models.database import (
    Entity, EntityFile, EntityFileType, EntityType, EntityStatus, Organization, User,
)
from api.services.similarity import detect_archived_duplicate, transliterate_ru_to_en

DB_URL = os.environ.get("DATABASE_URL", "")
MARKER = "demo_dup_fixture"

_TODAY = datetime.now()


def _d(days_ago: int) -> str:
    return (_TODAY - timedelta(days=days_ago)).strftime("%d.%m.%Y")


# Резюме и история — только у «старой» анкеты: так в окне сравнения видно, ЧТО
# теряется при неверном решении «это разные люди».
def _old_extra(**kw) -> dict:
    base = {
        MARKER: True,
        "timeline_events": [
            {"date": _d(120), "title": "Добавлен в базу"},
            {"date": _d(100), "title": "Скрининг"},
            {"date": _d(80), "title": "Техническое интервью"},
        ],
        "notes": [
            {"text": "Созвон был, просил вернуться через полгода.",
             "author_name": "Настя", "date": (_TODAY - timedelta(days=80)).isoformat()},
        ],
    }
    base.update(kw)
    return base


def _new_extra(**kw) -> dict:
    base = {MARKER: True}
    base.update(kw)
    return base


# (пояснение, «старая» анкета, «новая» анкета) — новая создаётся ПОСЛЕ старой,
# на ней и сработает детект.
PAIRS = [
    (
        "Точная почта (тир email, 100%)",
        dict(name="Гончарова Алиса", position="UX-дизайнер", company="Ozon",
             email="alisa.goncharova@gmail.com", phone="+7 903 118-44-01",
             status=EntityStatus.rejected,
             extra_data=_old_extra(city="Москва", birth_date="1994-03-12",
                                   rejection_reason="не сошлись по вилке",
                                   resume_text="UX-дизайнер, 7 лет. Ozon, Wildberries. Figma, CustDev.")),
        dict(name="Алиса Гончарова", position="Product Designer", company="Wildberries",
             email="alisa.goncharova@gmail.com", phone="+7 903 118-44-01",
             extra_data=_new_extra(city="Москва", birth_date="1994-03-12")),
    ),
    (
        "Почта сменила домен, локаль та же (тир email)",
        dict(name="Тарасов Вадим", position="Backend-разработчик", company="Тинькофф",
             email="v.tarasov@gmail.com",
             extra_data=_old_extra(city="Казань",
                                   resume_text="Python, FastAPI, PostgreSQL. 6 лет в финтехе.")),
        dict(name="Вадим Тарасов", position="Python Developer", company="Яндекс",
             email="v.tarasov@mail.ru",
             extra_data=_new_extra(city="Казань")),
    ),
    (
        "Телефон в другом формате (тир phone)",
        dict(name="Ильина Марина", position="Рекрутёр", company="Сбер",
             phone="8 (912) 345-67-89",
             extra_data=_old_extra(city="Екатеринбург",
                                   resume_text="IT-рекрутинг, 4 года. Массовый и точечный подбор.")),
        # Фамилия сменилась (замужество) — по ФИО пара не матчится, ловит только телефон.
        dict(name="Соколова Марина", position="Talent Acquisition", company="СберТех",
             phone="+7 912 3456789",
             extra_data=_new_extra(city="Екатеринбург")),
    ),
    (
        "ФИО с отчеством + транслит, контактов нет (тир name)",
        dict(name="Векленко Кирилл Дмитриевич", position="Аналитик", company="X5",
             extra_data=_old_extra(city="Москва",
                                   resume_text="Продуктовая аналитика, SQL, Python, A/B.")),
        dict(name="Kirill Veklenko", position="Data Analyst", company="Lamoda",
             extra_data=_new_extra(city="Москва")),
    ),
    (
        "Личный telegram (тир telegram)",
        dict(name="Шарипов Тимур", position="QA-инженер", company="МТС",
             telegram_usernames=["timur_qa_2024"],
             extra_data=_old_extra(city="Уфа", resume_text="Ручное и авто-тестирование, Playwright.")),
        dict(name="Тимур Ш.", position="QA Automation", company="VK",
             telegram_usernames=["@Timur_QA_2024"],
             extra_data=_new_extra(city="Уфа")),
    ),
    (
        "Та же ссылка на резюме hh (тир source)",
        dict(name="Кандидат без имени", position="Flutter Developer, Минск, 27 лет",
             extra_data=_old_extra(source_url="https://hh.ru/resume/a1b2c3d4e5f6?hhtmFrom=chat&t=111",
                                   resume_text="Flutter, Dart, 4 года.")),
        dict(name="Flutter Developer, Минск", position="Flutter Developer",
             extra_data=_new_extra(source_url="https://hh.ru/resume/a1b2c3d4e5f6?vacancyId=99&t=999")),
    ),
    (
        "Мягкий тир: другое ФИО, те же 7 цифр телефона + дата рождения",
        dict(name="Петров Александр", position="Маркетолог", company="Avito",
             phone="+7 916 000-11-22",
             extra_data=_old_extra(birth_date="1990-05-14", city="Москва",
                                   resume_text="Performance-маркетинг, 8 лет.")),
        dict(name="Сидоров Иван", position="Head of Growth", company="Ozon",
             phone="+7 495 000-11-22",
             extra_data=_new_extra(birth_date="14.05.1990", city="Москва")),
    ),
    (
        "Мягкий тир 75%: те же 7 цифр телефона + дата рождения, ГОРОДА РАЗНЫЕ",
        dict(name="Романова Ольга", position="Логист", company="СДЭК",
             phone="+7 921 777-31-40",
             extra_data=_old_extra(birth_date="1988-11-02", city="Санкт-Петербург",
                                   resume_text="Логистика и ВЭД, 7 лет.")),
        dict(name="Кузнецова Алина", position="Менеджер ВЭД", company="Байкал-Сервис",
             phone="+7 495 777-31-40",
             extra_data=_new_extra(birth_date="02.11.1988", city="Москва")),
    ),
    (
        "НИЖЕ ПОРОГА (48 баллов): та же дата рождения + тот же город — не показывается вовсе",
        dict(name="Зайцев Артём", position="Копирайтер", company="Skyeng",
             phone="+7 911 100-20-30",
             extra_data=_old_extra(birth_date="1995-07-19", city="Казань",
                                   resume_text="Тексты для образовательных проектов.")),
        dict(name="Морозов Денис", position="Редактор", company="Нетология",
             phone="+7 999 400-50-60",
             extra_data=_new_extra(birth_date="19.07.1995", city="Казань")),
    ),
    (
        "Текст резюме совпал ЧАСТИЧНО (инфо-тир text — слияние НЕ предлагается)",
        dict(name="Никитин Егор", position="SMM-менеджер", company="Самокат",
             email="egor.nikitin@yandex.ru",
             extra_data=_old_extra(
                 city="Санкт-Петербург",
                 summary="Запускал и вёл рекламные кампании в Facebook Ads и VK Ads, отвечал "
                         "за медиаплан, работал с блогерами и подрядчиками, считал юнит-экономику "
                         "и еженедельно отчитывался по ROMI перед руководителем отдела маркетинга.",
             )),
        dict(name="Соловьёв Никита", position="SMM", company="Додо Пицца",
             email="nikita.solovyov@yandex.ru",
             extra_data=_new_extra(
                 city="Москва",
                 # Тот же текст, но без последней фразы — совпадение 86%, а не 100%:
                 # в интерфейсе видно промежуточный процент текстового тира.
                 summary="Запускал и вёл рекламные кампании в Facebook Ads и VK Ads, отвечал "
                         "за медиаплан, работал с блогерами и подрядчиками, считал юнит-экономику "
                         "и еженедельно отчитывался по ROMI.",
             )),
    ),
    (
        "Дубль лежит в АРХИВЕ (виден только с include_archived)",
        dict(name="Жукова Ольга", position="Бухгалтер", company="Лента",
             email="olga.zhukova@bk.ru", phone="+7 921 555-30-10", is_archived=True,
             extra_data=_old_extra(city="Санкт-Петербург",
                                   description="Импорт ClickUp: бухгалтерия, 1С, 9 лет.")),
        dict(name="Ольга Жукова", position="Главный бухгалтер", company="Пятёрочка",
             email="olga.zhukova@bk.ru",
             extra_data=_new_extra(city="Санкт-Петербург")),
    ),
]


# Кейс Эльвиры (2026-09-16): «Иванов Кирилл Владимирович» поднимал ЧЕТЫРЁХ
# однофамильцев-тёзок с разными отчествами, и все шли как «точное совпадение».
# Проверяем, что теперь предлагаются только настоящие дубли (совпало отчество и
# совпал телефон), а трое с чужими отчествами не предлагаются вовсе.
NAMESAKES = [
    # (анкета, ожидание)
    (dict(name="Иванов Кирилл Владимирович", position="Логист", company="Деловые линии",
          phone="+7 917 200-40-60",
          extra_data=_old_extra(city="Нижний Новгород",
                                resume_text="Логистика, ВЭД, 5 лет.")),
     "дубль: то же отчество"),
    (dict(name="Кирилл Иванов", position="Специалист по логистике", company="СДЭК",
          phone="8 917 2004060",
          extra_data=_old_extra(city="Нижний Новгород",
                                resume_text="Та же карточка из другого источника.")),
     "дубль: тот же телефон"),
    (dict(name="Иванов Кирилл Евгеньевич", position="Водитель", company="Магнит",
          extra_data=_old_extra(city="Краснодар")), "однофамилец: другое отчество"),
    (dict(name="Иванов Кирилл Сергеевич", position="Менеджер", company="Ozon",
          extra_data=_old_extra(city="Москва")), "однофамилец: другое отчество"),
    (dict(name="Иванов Кирилл Петрович", position="Сварщик", company="ММК",
          extra_data=_old_extra(city="Магнитогорск")), "однофамилец: другое отчество"),
]
NAMESAKE_NEW = dict(name="Иванов Кирилл Владимирович", position="Руководитель склада",
                    company="Wildberries", phone="+7 917 200-40-60",
                    extra_data=_new_extra(city="Нижний Новгород"))


def _minimal_pdf(lines) -> bytes:
    """Однослойный валидный PDF из нескольких строк — чтобы в окне сравнения было
    что показать в рамке. Без внешних зависимостей: base-14 Helvetica, латиница
    (кириллица в WinAnsi всё равно не отрисуется, а для фикстуры это неважно)."""
    content = "BT /F1 14 Tf 60 780 Td 18 TL\n"
    for line in lines:
        # Base-14 Helvetica кириллицу не кодирует — транслитерируем тем же
        # хелпером, что и матчер, чтобы в фикстуре не было «????».
        safe = transliterate_ru_to_en(line).replace("\\", "").replace("(", "").replace(")", "")
        content += f"({safe}) Tj T*\n"
    content += "ET"
    stream = content.encode("latin-1", "replace")

    objects = [
        b"<</Type/Catalog/Pages 2 0 R>>",
        b"<</Type/Pages/Kids[3 0 R]/Count 1>>",
        b"<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]"
        b"/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>",
        b"<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>",
        b"<</Length " + str(len(stream)).encode() + b">>stream\n" + stream + b"\nendstream",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for i, body in enumerate(objects, start=1):
        offsets.append(len(out))
        # Пробел перед endobj обязателен: иначе "endstreamendobj" склеивается в
        # один токен и просмотрщик считает файл битым.
        out += f"{i} 0 obj".encode() + body + b"\nendobj\n"
    xref_at = len(out)
    out += f"xref\n0 {len(objects) + 1}\n".encode()
    out += b"0000000000 65535 f \n"
    for off in offsets:
        out += f"{off:010d} 00000 n \n".encode()
    out += (
        f"trailer<</Size {len(objects) + 1}/Root 1 0 R>>\nstartxref\n{xref_at}\n%%EOF".encode()
    )
    return bytes(out)


def _cv_lines(name, position, company, city) -> list:
    """Текст демо-резюме. Длиной не меньше настоящего: извлечение текста
    (services/resume_text_extract) отбрасывает обрывки короче 200 символов, и на
    трёхстрочной заглушке проверить бэкфилл было бы нельзя."""
    body = (
        f"Position: {position or '-'}. Company: {company or '-'}. City: {city or '-'}. "
        "Experience: led hiring for engineering and marketing teams, built the "
        "sourcing funnel from scratch and tracked stage conversion weekly. "
        "Ran screening calls, coordinated technical interviews with hiring "
        "managers and prepared offers together with the compensation team. "
        "Worked with ATS analytics, kept the candidate database clean and "
        "de-duplicated, reported hiring metrics to the department head. "
        "Skills: sourcing, screening, interviewing, ATS, reporting, analytics."
    )
    return [f"CV: {name}"] + [body[i:i + 88] for i in range(0, len(body), 88)]


def _attach_resume(db: AsyncSession, entity: Entity, org_id: int, lines) -> None:
    """Прикрепить кандидату PDF-резюме (file_type=resume) — ровно так же, как это
    делает загрузка файла в карточке: содержимое лежит в БД (file_data)."""
    data = _minimal_pdf(lines)
    db.add(EntityFile(
        entity_id=entity.id, org_id=org_id, file_type=EntityFileType.resume,
        file_name=f"resume_{entity.id}.pdf", file_data=data, file_size=len(data),
        mime_type="application/pdf", description="Демо-резюме для проверки дублей",
    ))


async def _purge(db: AsyncSession, org_id: int) -> int:
    rows = (await db.execute(
        select(Entity).where(Entity.org_id == org_id, Entity.type == EntityType.candidate)
    )).scalars().all()
    killed = 0
    for e in rows:
        if isinstance(e.extra_data, dict) and e.extra_data.get(MARKER):
            await db.delete(e)
            killed += 1
    # Чужие карточки могли получить ссылку на удалённые — снимаем висячие флаги.
    ids = {e.id for e in rows if isinstance(e.extra_data, dict) and e.extra_data.get(MARKER)}
    for e in rows:
        if not isinstance(e.extra_data, dict) or e.extra_data.get(MARKER):
            continue
        if e.extra_data.get("hidden_duplicate_id") in ids:
            ne = dict(e.extra_data)
            ne.pop("hidden_duplicate_id", None)
            ne.pop("hidden_duplicate_meta", None)
            e.extra_data = ne
    await db.commit()
    return killed


async def main() -> None:
    if "localhost" not in DB_URL and "127.0.0.1" not in DB_URL:
        raise SystemExit(f"Отказ: DATABASE_URL не локальный ({DB_URL!r}). Скрипт только для локальной базы.")

    engine = create_async_engine(DB_URL, echo=False)
    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with Session() as db:
        org = (await db.execute(
            select(Organization).where(Organization.slug == "default")
        )).scalar_one_or_none()
        if org is None:
            raise SystemExit("Нет организации 'default'. Запусти бэкенд — он создаёт её на старте.")

        killed = await _purge(db, org.id)
        if killed:
            print(f"Удалено прошлых демо-дублей: {killed}")
        if "--purge" in sys.argv:
            await engine.dispose()
            return

        author = (await db.execute(
            select(User).where(User.email == "recruiter.test@example.com")
        )).scalar_one_or_none()
        author_id = author.id if author else None

        print("Создаю пары дублей:")
        for title, old_kw, new_kw in PAIRS:
            old = Entity(org_id=org.id, type=EntityType.candidate, created_by=author_id,
                         status=old_kw.pop("status", EntityStatus.new), **old_kw)
            db.add(old)
            await db.flush()

            _attach_resume(db, old, org.id, _cv_lines(
                old.name, old_kw.get("position"), old_kw.get("company"),
                (old_kw.get("extra_data") or {}).get("city"),
            ))

            new = Entity(org_id=org.id, type=EntityType.candidate, created_by=author_id,
                         status=EntityStatus.new, **new_kw)
            db.add(new)
            await db.flush()

            # Тот же путь, что у ручного добавления кандидата: детект личности +
            # детектор копипаста текста резюме.
            from api.services.resume_text_twin import detect_resume_text_twin
            match_id = await detect_archived_duplicate(db, new)
            if match_id:
                # Ровно как на пути создания кандидата (routes/entities/crud.py):
                # сам детект пишет только мету, а ссылку на пару ставит вызывающий.
                extra = dict(new.extra_data or {})
                extra["hidden_duplicate_id"] = match_id
                new.extra_data = extra
                await db.flush()
            twin_id, sim = await detect_resume_text_twin(db, new)
            meta = (new.extra_data or {}).get("hidden_duplicate_meta") or {}
            mark = (
                f"тир {meta.get('strength')} · {meta.get('confidence')}%"
                if match_id else (f"только текст ({round(sim * 100)}%)" if twin_id else "НЕ найден")
            )
            print(f"  [{old.id} ← {new.id}] {title}\n        {new.name}: {mark}")

        print("\nКейс Эльвиры — один новый кандидат против пяти однофамильцев:")
        for kw, note in NAMESAKES:
            old = Entity(org_id=org.id, type=EntityType.candidate, created_by=author_id,
                         status=EntityStatus.new, **kw)
            db.add(old)
            await db.flush()
            _attach_resume(db, old, org.id, _cv_lines(
                old.name, kw.get("position"), kw.get("company"),
                (kw.get("extra_data") or {}).get("city"),
            ))
            print(f"  [{old.id}] {old.name:32} — {note}")
        new = Entity(org_id=org.id, type=EntityType.candidate, created_by=author_id,
                     status=EntityStatus.new, **NAMESAKE_NEW)
        db.add(new)
        await db.flush()
        match_id = await detect_archived_duplicate(db, new)
        if match_id:
            extra = dict(new.extra_data or {})
            extra["hidden_duplicate_id"] = match_id
            new.extra_data = extra
            await db.flush()
        from api.services.similarity import similarity_service
        offered = await similarity_service.detect_duplicates(db=db, entity=new)
        print(f"  [{new.id}] {new.name:32} — НОВЫЙ, предложено дублей: {len(offered)}")
        for d in offered:
            print(f"        → {d.entity_id} {d.entity_name} · {d.strength} {d.confidence}%")

        await db.commit()

    await engine.dispose()
    print("\nГотово. Убрать демо-данные: .venv/bin/python seed_duplicates_demo.py --purge")


if __name__ == "__main__":
    asyncio.run(main())
