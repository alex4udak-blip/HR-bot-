"""Наполнение ЛОКАЛЬНОЙ базы демо-данными — чтобы было что кликать.

Не для прода: скрипт отказывается работать, если DATABASE_URL не смотрит на
localhost. Идемпотентен — повторный запуск ничего не дублирует, ищет по email
и по названию вакансии.

    cd backend && .venv/bin/python seed_local.py

Создаёт трёх рекрутёров (пароль у всех local123), две открытые воронки и
несколько кандидатов на разных этапах — включая одного в двух воронках сразу
и одного отказанного, чтобы было видно, как HR-метки появляются и пропадают.
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker

from api.models.database import (
    User, UserRole, Organization, OrgMember, OrgRole,
    Vacancy, VacancyStatus, Entity, EntityType, EntityStatus,
    VacancyApplication, ApplicationStage,
)
from api.services.auth import hash_password

DB_URL = os.environ.get("DATABASE_URL", "")

RECRUITERS = [
    ("valentina@hrbot.dev", "Валентина", OrgRole.hr),
    ("elvira@hrbot.dev", "Эльвира Ефименко", OrgRole.hr),
    ("maria@hrbot.dev", "Мария", OrgRole.admin),
]

VACANCIES = [
    ("User Acquisition Manager", "valentina@hrbot.dev"),
    ("Head of User Acquisition", "elvira@hrbot.dev"),
]

# (имя, должность, воронка, этап, кто добавил)
CANDIDATES = [
    ("Гилев Данила", "Таргетолог", "User Acquisition Manager", ApplicationStage.applied, "valentina@hrbot.dev"),
    ("Кравцов Артём", "Lead User Acquisition", "User Acquisition Manager", ApplicationStage.screening, "valentina@hrbot.dev"),
    ("Морозов Олександр", "Chief Marketing Officer", "User Acquisition Manager", ApplicationStage.interview, "elvira@hrbot.dev"),
    ("Платонов Роман", "Senior Performance Marketing", "Head of User Acquisition", ApplicationStage.applied, "elvira@hrbot.dev"),
    ("Блинова Анастасия", "Head of Digital", "Head of User Acquisition", ApplicationStage.offer, "elvira@hrbot.dev"),
    # Отказ — у него HR-метки быть НЕ должно, стадия исключена из расчёта.
    ("Шеншин Игорь", "Media Buyer", "Head of User Acquisition", ApplicationStage.rejected, "elvira@hrbot.dev"),
]

# Кандидат сразу в двух воронках → две HR-метки на одной карточке.
SECOND_FUNNEL = ("Гилев Данила", "Head of User Acquisition", ApplicationStage.screening, "elvira@hrbot.dev")


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
            raise SystemExit("Нет организации 'default'. Запусти сначала бэкенд — он создаёт её на старте.")

        users: dict[str, User] = {}
        for email, name, role in RECRUITERS:
            user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
            if user is None:
                user = User(
                    email=email,
                    password_hash=hash_password("local123"),
                    name=name,
                    role=UserRole.member,
                    is_active=True,
                )
                db.add(user)
                await db.flush()
                print(f"  + пользователь {name} <{email}>")
            users[email] = user

            member = (await db.execute(select(OrgMember).where(
                OrgMember.org_id == org.id, OrgMember.user_id == user.id
            ))).scalar_one_or_none()
            if member is None:
                db.add(OrgMember(org_id=org.id, user_id=user.id, role=role, is_readonly=False))
                print(f"    роль в организации: {role.value}")

        await db.flush()

        vacs: dict[str, Vacancy] = {}
        for title, owner_email in VACANCIES:
            owner = users[owner_email]
            vac = (await db.execute(select(Vacancy).where(
                Vacancy.org_id == org.id, Vacancy.title == title
            ))).scalar_one_or_none()
            if vac is None:
                vac = Vacancy(
                    org_id=org.id,
                    title=title,
                    description="Демо-воронка для локальной проверки.",
                    status=VacancyStatus.open,
                    visible_to_all=True,
                    created_by=owner.id,
                    assigned_to=[owner.id],
                    # accepted_by — «взял в работу лично»; без него воронка не
                    # попадёт в «Мои вакансии» (isPersonallyActive на фронте).
                    extra_data={"accepted_by": [owner.id]},
                )
                db.add(vac)
                await db.flush()
                print(f"  + воронка «{title}» (рекрутёр {owner.name})")
            vacs[title] = vac

        await db.flush()

        ents: dict[str, Entity] = {}
        for name, position, vac_title, stage, adder_email in CANDIDATES:
            ent = (await db.execute(select(Entity).where(
                Entity.org_id == org.id, Entity.name == name
            ))).scalar_one_or_none()
            if ent is None:
                ent = Entity(
                    org_id=org.id,
                    type=EntityType.candidate,
                    name=name,
                    position=position,
                    status=EntityStatus.new,
                    created_by=users[adder_email].id,
                    extra_data={"source": "seed"},
                )
                db.add(ent)
                await db.flush()
                print(f"  + кандидат {name}")
            ents[name] = ent

            await _ensure_application(db, vacs[vac_title], ent, stage, users[adder_email])

        name, vac_title, stage, adder_email = SECOND_FUNNEL
        await _ensure_application(db, vacs[vac_title], ents[name], stage, users[adder_email])

        await db.commit()

        # HR-метки считаются из заявок — пересчитываем, иначе карточки будут
        # без меток до первого открытия (self-heal сработал бы и сам, но
        # проверять фичу на пустых метках неудобно).
        from api.services.hr_tags import sync_for_entity
        for ent in ents.values():
            await sync_for_entity(db, ent.id, commit=False)
        await db.commit()

    await engine.dispose()
    print("\nГотово. Вход: valentina@hrbot.dev / elvira@hrbot.dev / maria@hrbot.dev, пароль local123")


async def _ensure_application(
    db: AsyncSession, vac: Vacancy, ent: Entity, stage: ApplicationStage, adder: User
) -> None:
    app = (await db.execute(select(VacancyApplication).where(
        VacancyApplication.vacancy_id == vac.id,
        VacancyApplication.entity_id == ent.id,
    ))).scalar_one_or_none()
    if app is not None:
        return
    db.add(VacancyApplication(
        vacancy_id=vac.id,
        entity_id=ent.id,
        stage=stage,
        stage_order=0,
        source="seed",
        created_by=adder.id,
    ))
    await db.flush()
    print(f"    → {ent.name} в «{vac.title}», этап {stage.value}, добавил {adder.name}")


if __name__ == "__main__":
    asyncio.run(main())
