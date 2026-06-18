# Анкета (конструктор + персональная отправка) — MVP-1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Из кнопки «Анкета» на карточке кандидата открывать шторку-конструктор, отправлять анкету конкретному кандидату по персональной ссылке, получать ответ обратно в ту же карточку с мгновенным бейджем и пушем в Inbox.

**Architecture:** Расширяем существующий модуль форм (JSONB-модель `FormTemplate`/`FormSubmission`). Новая таблица `form_dispatches` (форма↔кандидат↔токен) делает ссылку персональной; публичный сабмит по токену прикрепляет ответ к существующему `Entity`, не создавая нового. Real-time — поверх готового WebSocket (`realtime.py`) новым событием `form.submission`. UI — переиспользуемый `<FormBuilder>` в radix-Dialog (lazy).

**Tech Stack:** Backend — FastAPI, SQLAlchemy 2.0 (async), Alembic, pytest+httpx. Frontend — React 18, react-router 7, Zustand, react-query, `@radix-ui/react-dialog`, framer-motion, vitest.

> **STATUS (2026-06-17):** T1–T18 реализованы и проверены — backend 6/6 тестов зелёные; frontend `tsc --noEmit` + `npm run build` + vitest зелёные; realtime-путь подключён end-to-end (broadcast → useWebSocket → WebSocketProvider → сторы → бейдж + Inbox). НЕ закоммичено — ждёт команды «Пуш». T19 (ручной e2e) ещё не выполнялся. Миграции: обнаружено 6 разошедшихся alembic-heads → добавлена merge-миграция `merge_heads_2026_06_17`.
>
> **UPDATE (2026-06-18):** прогон в Docker прошёл (login OK, e2e кандидатской формы зелёный); по ходу пофикшены инфра-баги — `start.sh` CRLF→LF, `docker-compose.yml` +COOKIE_SECURE/ALLOWED_ORIGINS, и обойдён сломанный fresh-DB alembic (заведён task_a0a4bf9d). Решение пользователя: модуль целимся в **Survio-parity**, и в MVP-1 билдер поднимается до **WYSIWYG** — см. раздел «WYSIWYG BUILDER UPGRADE» (T20–T21), в работе.

---

## ⚠️ Правила этого репозитория (обязательно)

1. **Без коммитов/пушей до команды «Пуш»** от пользователя. Шаги «Commit» в задачах НЕ выполнять сразу — накапливать. Команды для коммита приведены в конце (раздел «Коммиты»), их запускать только после «Пуш».
2. **Никогда `git add -A` / `git add .`** — в рабочем дереве бывает параллельный WIP пользователя. Всегда `git add <конкретные файлы>` и `git status` перед коммитом.
3. **Миграции в этом проекте ненадёжны** (см. `backend/start.sh`: «fallback for broken migration chain»). Поэтому каждая новая таблица заводится в ТРЁХ местах: (a) SQLAlchemy-модель → `Base.metadata.create_all` поднимает её на свежей БД и в тестах; (b) Alembic-миграция; (c) идемпотентный safety-net в `start.sh` — именно он реально создаёт таблицу на проде (Saturn/Coolify). Пропуск (c) = фича молча не работает на проде.
4. **Деплой ручной:** автодеплой сломан — после пуша пользователь жмёт Deploy в Coolify; открытая вкладка требует Ctrl+Shift+R.

---

## File Structure

**Backend (создать/изменить):**
- `backend/api/models/database.py` — +модель `FormDispatch`, +колонка `FormSubmission.dispatch_id`.
- `backend/alembic/versions/add_form_dispatches.py` — **создать** миграцию.
- `backend/start.sh` — +идемпотентный блок (create table `form_dispatches` + add column `dispatch_id`).
- `backend/api/routes/forms.py` — +эндпоинты: dispatch, public-by-token, entity-dispatches, unread-count, mark-seen.
- `backend/api/routes/realtime.py` — +`broadcast_form_submission(...)`.
- `backend/api/services/hr_notifications.py` — +`notify_form_submitted(...)`.
- `backend/tests/test_form_dispatch.py` — **создать** тесты.

**Frontend (создать/изменить):**
- `frontend/src/services/api/forms.ts` — +`scale` в типе поля, +API персональной отправки/ответов/бейджа.
- `frontend/src/types/websocket.ts` — +событие `form.submission`.
- `frontend/src/hooks/useWebSocket.ts` — +`onFormSubmission`.
- `frontend/src/stores/notificationStore.ts` — **создать** (глобальный счётчик Inbox, мгновенный).
- `frontend/src/stores/formBadgeStore.ts` — **создать** (per-entity бейдж).
- `frontend/src/components/WebSocketProvider.tsx` — подписка на `form.submission`.
- `frontend/src/components/Layout.tsx` — счётчик колокольчика из `notificationStore`.
- `frontend/src/components/hr/HuntflowControls.tsx` — +`notificationCount` в `HuntflowActionChip`.
- `frontend/src/features/forms/FormBuilder.tsx` — **создать** (вынос `FormEditView`).
- `frontend/src/features/forms/AnketaDrawer.tsx` — **создать** (шторка, lazy).
- `frontend/src/features/forms/formTemplates.ts` — **создать** (сид-пресеты).
- `frontend/src/pages/FormBuilderPage.tsx` — переключить на вынесенный `FormBuilder`.
- `frontend/src/pages/PublicFormPage.tsx` — +режим токена, +рендер `scale`.
- `frontend/src/pages/AllCandidatesPage.tsx` — +чип «Анкета» с бейджем + lazy-mount `AnketaDrawer`.
- `frontend/src/App.tsx` — +роут `/form/d/:token`.

---

# BACKEND

## Task 1: Модель `FormDispatch` + `FormSubmission.dispatch_id`

**Files:**
- Modify: `backend/api/models/database.py` (после класса `FormVacancy`, ~строка 1546)
- Modify: `backend/api/models/database.py:1517` (класс `FormSubmission` — добавить колонку)
- Test: `backend/tests/test_form_dispatch.py`

- [ ] **Step 1: Написать падающий тест**

Создать `backend/tests/test_form_dispatch.py`:
```python
import pytest
from sqlalchemy import select

from api.models.database import (
    FormTemplate, FormDispatch, FormSubmission, Entity, EntityType, EntityStatus, Organization,
)


@pytest.mark.asyncio
async def test_form_dispatch_model_roundtrip(db_session, organization: Organization):
    form = FormTemplate(org_id=organization.id, title="Скрининг", slug="screening-abc123", fields=[])
    db_session.add(form)
    await db_session.flush()

    entity = Entity(org_id=organization.id, type=EntityType.candidate, name="Анна", status=EntityStatus.new)
    db_session.add(entity)
    await db_session.flush()

    dispatch = FormDispatch(form_id=form.id, entity_id=entity.id, token="tok_test_123")
    db_session.add(dispatch)
    await db_session.commit()

    row = (await db_session.execute(
        select(FormDispatch).where(FormDispatch.token == "tok_test_123")
    )).scalar_one()
    assert row.status == "sent"
    assert row.seen_by_recruiter is False
    assert row.entity_id == entity.id
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `cd backend && python -m pytest tests/test_form_dispatch.py::test_form_dispatch_model_roundtrip -v`
Expected: FAIL — `ImportError: cannot import name 'FormDispatch'`.

- [ ] **Step 3: Добавить колонку в `FormSubmission`**

В `backend/api/models/database.py` в классе `FormSubmission` (после строки `data = Column(JSON, nullable=False)`):
```python
    dispatch_id = Column(Integer, ForeignKey("form_dispatches.id", ondelete="SET NULL"), nullable=True, index=True)
```

- [ ] **Step 4: Добавить модель `FormDispatch`** (сразу после класса `FormVacancy`)

```python
class FormDispatch(Base):
    """Анкета, отправленная конкретному существующему кандидату по личной ссылке."""
    __tablename__ = "form_dispatches"

    id = Column(Integer, primary_key=True)
    form_id = Column(Integer, ForeignKey("form_templates.id", ondelete="CASCADE"), nullable=False, index=True)
    entity_id = Column(Integer, ForeignKey("entities.id", ondelete="CASCADE"), nullable=False, index=True)
    token = Column(String(64), unique=True, nullable=False, index=True)
    status = Column(String(20), default="sent")            # sent | opened | submitted
    submission_id = Column(Integer, ForeignKey("form_submissions.id", ondelete="SET NULL"), nullable=True)
    seen_by_recruiter = Column(Boolean, default=False)     # управляет бейджем на кнопке
    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=func.now())
    opened_at = Column(DateTime, nullable=True)
    submitted_at = Column(DateTime, nullable=True)

    form = relationship("FormTemplate")
    entity = relationship("Entity")
```

- [ ] **Step 5: Запустить — убедиться, что проходит**

Run: `cd backend && python -m pytest tests/test_form_dispatch.py::test_form_dispatch_model_roundtrip -v`
Expected: PASS.

---

## Task 2: Alembic-миграция + safety-net в `start.sh`

**Files:**
- Create: `backend/alembic/versions/add_form_dispatches.py`
- Modify: `backend/start.sh` (внутри `async with engine.begin() as conn:` блока, рядом с созданием `entity_tags` ~строка 191)

- [ ] **Step 1: Узнать текущий head миграций**

Run: `cd backend && python -m alembic heads`
Записать выведенный id (например `8e2df4526551` или иной). Это значение пойдёт в `down_revision`.

- [ ] **Step 2: Создать миграцию** `backend/alembic/versions/add_form_dispatches.py` (стиль — как `add_form_templates.py`, с guard'ами):

```python
"""Add form_dispatches table and form_submissions.dispatch_id

Revision ID: add_form_dispatches
Revises: <ВСТАВИТЬ_HEAD_ИЗ_ШАГА_1>
Create Date: 2026-06-17
"""
from alembic import op
import sqlalchemy as sa

revision = 'add_form_dispatches'
down_revision = '<ВСТАВИТЬ_HEAD_ИЗ_ШАГА_1>'
branch_labels = None
depends_on = None


def table_exists(name):
    conn = op.get_bind()
    r = conn.execute(sa.text(
        "SELECT 1 FROM information_schema.tables WHERE table_name = :t"), {"t": name})
    return r.fetchone() is not None


def column_exists(table, column):
    conn = op.get_bind()
    r = conn.execute(sa.text(
        "SELECT 1 FROM information_schema.columns WHERE table_name = :t AND column_name = :c"),
        {"t": table, "c": column})
    return r.fetchone() is not None


def upgrade() -> None:
    if not table_exists("form_dispatches"):
        op.create_table(
            "form_dispatches",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("form_id", sa.Integer(), sa.ForeignKey("form_templates.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("entity_id", sa.Integer(), sa.ForeignKey("entities.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("token", sa.String(64), unique=True, nullable=False, index=True),
            sa.Column("status", sa.String(20), server_default="sent"),
            sa.Column("submission_id", sa.Integer(), sa.ForeignKey("form_submissions.id", ondelete="SET NULL"), nullable=True),
            sa.Column("seen_by_recruiter", sa.Boolean(), server_default="false"),
            sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
            sa.Column("opened_at", sa.DateTime(), nullable=True),
            sa.Column("submitted_at", sa.DateTime(), nullable=True),
        )
    if not column_exists("form_submissions", "dispatch_id"):
        op.add_column("form_submissions", sa.Column("dispatch_id", sa.Integer(),
                      sa.ForeignKey("form_dispatches.id", ondelete="SET NULL"), nullable=True))


def downgrade() -> None:
    if column_exists("form_submissions", "dispatch_id"):
        op.drop_column("form_submissions", "dispatch_id")
    if table_exists("form_dispatches"):
        op.drop_table("form_dispatches")
```

- [ ] **Step 3: Добавить safety-net в `backend/start.sh`**

Внутри `async with engine.begin() as conn:` (рядом с блоком `entity_tags`, ~строка 191) вставить:
```python
        # form_dispatches: персональная отправка анкеты кандидату
        result = await conn.execute(text(
            \"SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'form_dispatches')\"
        ))
        if not result.scalar():
            print('Creating form_dispatches table...')
            await conn.execute(text('''
                CREATE TABLE form_dispatches (
                    id SERIAL PRIMARY KEY,
                    form_id INTEGER NOT NULL REFERENCES form_templates(id) ON DELETE CASCADE,
                    entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
                    token VARCHAR(64) NOT NULL UNIQUE,
                    status VARCHAR(20) DEFAULT 'sent',
                    submission_id INTEGER REFERENCES form_submissions(id) ON DELETE SET NULL,
                    seen_by_recruiter BOOLEAN DEFAULT false,
                    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
                    created_at TIMESTAMP DEFAULT now(),
                    opened_at TIMESTAMP,
                    submitted_at TIMESTAMP
                )
            '''))
            await conn.execute(text('CREATE INDEX ix_form_dispatch_entity ON form_dispatches (entity_id)'))
            await conn.execute(text('CREATE INDEX ix_form_dispatch_token ON form_dispatches (token)'))

        # form_submissions.dispatch_id
        result = await conn.execute(text(
            \"SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'form_submissions' AND column_name = 'dispatch_id')\"
        ))
        if not result.scalar():
            print('Adding dispatch_id column to form_submissions...')
            await conn.execute(text('ALTER TABLE form_submissions ADD COLUMN dispatch_id INTEGER REFERENCES form_dispatches(id) ON DELETE SET NULL'))
```

- [ ] **Step 4: Проверить, что миграция применяется на чистой sqlite**

Run: `cd backend && python -m alembic upgrade head`
Expected: без ошибок (или «Migrations completed»). Тесты Task 1 уже подтверждают модель через `create_all`.

---

## Task 3: `POST /api/forms/{form_id}/dispatch` — создать персональную отправку

**Files:**
- Modify: `backend/api/routes/forms.py` (после `list_submissions`, перед публичными роутами ~строка 434)
- Test: `backend/tests/test_form_dispatch.py`

- [ ] **Step 1: Тест**
```python
from api.services.auth import create_access_token


def _headers(user):
    return {"Authorization": f"Bearer {create_access_token(data={'sub': str(user.id)})}"}


@pytest.mark.asyncio
async def test_create_dispatch_returns_token(client, db_session, organization, admin_user, org_owner):
    form = FormTemplate(org_id=organization.id, created_by=admin_user.id, title="Скрининг", slug="scr-1", fields=[])
    entity = Entity(org_id=organization.id, type=EntityType.candidate, name="Анна", status=EntityStatus.new)
    db_session.add_all([form, entity])
    await db_session.commit()

    resp = await client.post(f"/api/forms/{form.id}/dispatch", json={"entity_id": entity.id}, headers=_headers(admin_user))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["token"]
    assert body["url"].endswith(body["token"])
    assert body["entity_id"] == entity.id
```
(`org_owner` фикстура делает `admin_user` владельцем `organization` → `get_user_org` его находит.)

- [ ] **Step 2: Запустить — FAIL** (404, эндпоинта нет)
Run: `cd backend && python -m pytest tests/test_form_dispatch.py::test_create_dispatch_returns_token -v`

- [ ] **Step 3: Реализация.** В `forms.py` добавить импорт `FormDispatch` в существующий блок импортов моделей (строка ~19-25) и эндпоинт:
```python
class DispatchCreateSchema(BaseModel):
    entity_id: int


@router.post("/{form_id}/dispatch")
async def create_dispatch(
    form_id: int,
    body: DispatchCreateSchema,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Создать персональную отправку анкеты существующему кандидату."""
    current_user = await db.merge(current_user)
    org = await get_user_org(current_user, db)

    form = (await db.execute(select(FormTemplate).where(FormTemplate.id == form_id))).scalar_one_or_none()
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")
    entity = (await db.execute(select(Entity).where(Entity.id == body.entity_id))).scalar_one_or_none()
    if not entity:
        raise HTTPException(status_code=404, detail="Candidate not found")

    if current_user.role != UserRole.superadmin:
        if not org or form.org_id != org.id or entity.org_id != org.id:
            raise HTTPException(status_code=403, detail="Access denied")

    token = uuid.uuid4().hex
    dispatch = FormDispatch(form_id=form.id, entity_id=entity.id, token=token, created_by=current_user.id)
    db.add(dispatch)
    await db.commit()
    await db.refresh(dispatch)

    return {
        "id": dispatch.id,
        "token": token,
        "url": f"/form/d/{token}",
        "entity_id": entity.id,
        "form_id": form.id,
        "status": dispatch.status,
    }
```

- [ ] **Step 4: Запустить — PASS**
Run: `cd backend && python -m pytest tests/test_form_dispatch.py::test_create_dispatch_returns_token -v`

---

## Task 4: `GET /api/forms/public/d/{token}` — публичный показ по токену

**Files:**
- Modify: `backend/api/routes/forms.py` (в секции публичных роутов, после `get_public_form`)
- Test: `backend/tests/test_form_dispatch.py`

- [ ] **Step 1: Тест**
```python
@pytest.mark.asyncio
async def test_public_form_by_token(client, db_session, organization, admin_user):
    form = FormTemplate(org_id=organization.id, created_by=admin_user.id, title="Скрининг", slug="scr-2",
                        fields=[{"id": "f1", "type": "text", "label": "ФИО", "required": True}])
    entity = Entity(org_id=organization.id, type=EntityType.candidate, name="Анна", status=EntityStatus.new)
    db_session.add_all([form, entity])
    await db_session.flush()
    db_session.add(FormDispatch(form_id=form.id, entity_id=entity.id, token="tokpub1"))
    await db_session.commit()

    resp = await client.get("/api/forms/public/d/tokpub1")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["title"] == "Скрининг"
    assert body["fields"][0]["id"] == "f1"
    assert body["candidate_name"] == "Анна"
```

- [ ] **Step 2: FAIL**
Run: `cd backend && python -m pytest tests/test_form_dispatch.py::test_public_form_by_token -v`

- [ ] **Step 3: Реализация** (помечает `opened`):
```python
@router.get("/public/d/{token}")
async def get_public_form_by_token(token: str, db: AsyncSession = Depends(get_db)):
    """Публичный показ персональной анкеты (без авторизации)."""
    dispatch = (await db.execute(select(FormDispatch).where(FormDispatch.token == token))).scalar_one_or_none()
    if not dispatch:
        raise HTTPException(status_code=404, detail="Анкета не найдена")
    form = (await db.execute(
        select(FormTemplate).where(FormTemplate.id == dispatch.form_id, FormTemplate.is_active == True)
    )).scalar_one_or_none()
    if not form:
        raise HTTPException(status_code=404, detail="Анкета недоступна")

    entity = (await db.execute(select(Entity).where(Entity.id == dispatch.entity_id))).scalar_one_or_none()

    if dispatch.status == "sent":
        dispatch.status = "opened"
        dispatch.opened_at = datetime.utcnow()
        await db.commit()

    return {
        "id": form.id,
        "title": form.title,
        "description": form.description,
        "fields": form.fields or [],
        "candidate_name": entity.name if entity else None,
        "already_submitted": dispatch.status == "submitted",
    }
```

- [ ] **Step 4: PASS**
Run: `cd backend && python -m pytest tests/test_form_dispatch.py::test_public_form_by_token -v`

---

## Task 5: `POST /api/forms/public/d/{token}/submit` — привязка ответа к существующему кандидату

**Files:**
- Modify: `backend/api/routes/forms.py`
- Test: `backend/tests/test_form_dispatch.py`

- [ ] **Step 1: Тест — ответ прикрепляется к существующему entity, нового НЕ создаёт**
```python
from api.models.database import FormSubmission


@pytest.mark.asyncio
async def test_token_submit_attaches_to_existing_candidate(client, db_session, organization, admin_user):
    form = FormTemplate(org_id=organization.id, created_by=admin_user.id, title="Скрининг", slug="scr-3",
                        fields=[{"id": "f1", "type": "text", "label": "ФИО", "required": True}])
    entity = Entity(org_id=organization.id, type=EntityType.candidate, name="Анна", status=EntityStatus.new)
    db_session.add_all([form, entity])
    await db_session.flush()
    entity_id = entity.id
    db_session.add(FormDispatch(form_id=form.id, entity_id=entity.id, token="toksub1", created_by=admin_user.id))
    await db_session.commit()

    before = len((await db_session.execute(select(Entity))).scalars().all())
    resp = await client.post("/api/forms/public/d/toksub1/submit", json={"data": {"f1": "Анна Иванова"}})
    assert resp.status_code == 200, resp.text

    after = len((await db_session.execute(select(Entity))).scalars().all())
    assert after == before, "новый кандидат не должен создаваться"

    sub = (await db_session.execute(select(FormSubmission))).scalar_one()
    assert sub.entity_id == entity_id
    assert sub.data["f1"] == "Анна Иванова"

    disp = (await db_session.execute(select(FormDispatch).where(FormDispatch.token == "toksub1"))).scalar_one()
    assert disp.status == "submitted"
    assert disp.seen_by_recruiter is False
    assert disp.submission_id == sub.id
```

- [ ] **Step 2: FAIL**
Run: `cd backend && python -m pytest tests/test_form_dispatch.py::test_token_submit_attaches_to_existing_candidate -v`

- [ ] **Step 3: Реализация**
```python
@router.post("/public/d/{token}/submit")
async def submit_public_form_by_token(
    token: str,
    body: PublicSubmitSchema,
    db: AsyncSession = Depends(get_db),
):
    """Публичная отправка персональной анкеты — привязка к существующему кандидату."""
    dispatch = (await db.execute(select(FormDispatch).where(FormDispatch.token == token))).scalar_one_or_none()
    if not dispatch:
        raise HTTPException(status_code=404, detail="Анкета не найдена")
    if dispatch.status == "submitted":
        raise HTTPException(status_code=409, detail="Анкета уже заполнена")
    form = (await db.execute(
        select(FormTemplate).where(FormTemplate.id == dispatch.form_id, FormTemplate.is_active == True)
    )).scalar_one_or_none()
    if not form:
        raise HTTPException(status_code=404, detail="Анкета недоступна")

    # Валидация обязательных полей (как в slug-сабмите)
    for field in (form.fields or []):
        if field.get("required") and field.get("type") != "file":
            val = body.data.get(field["id"])
            if val is None or (isinstance(val, str) and not val.strip()):
                raise HTTPException(status_code=422, detail=f"Поле '{field['label']}' обязательно для заполнения")

    submission = FormSubmission(form_id=form.id, entity_id=dispatch.entity_id, data=body.data, dispatch_id=dispatch.id)
    db.add(submission)
    await db.flush()

    dispatch.status = "submitted"
    dispatch.submitted_at = datetime.utcnow()
    dispatch.submission_id = submission.id
    dispatch.seen_by_recruiter = False
    await db.commit()

    # Нотификация + WS (fire-and-forget)
    try:
        entity = (await db.execute(select(Entity).where(Entity.id == dispatch.entity_id))).scalar_one_or_none()
        from ..services.hr_notifications import notify_form_submitted
        await notify_form_submitted(db, dispatch, entity, form)
        from .realtime import broadcast_form_submission
        await broadcast_form_submission(form.org_id, {
            "entity_id": dispatch.entity_id,
            "form_id": form.id,
            "dispatch_id": dispatch.id,
            "form_title": form.title,
            "candidate_name": entity.name if entity else None,
        })
    except Exception:
        logger.exception("form.submission notify/broadcast failed (non-critical)")

    return {"message": "Спасибо! Ваша анкета успешно отправлена.", "entity_id": dispatch.entity_id}
```
(`notify_form_submitted` и `broadcast_form_submission` создаются в Task 7 — этот тест проходит и без них, т.к. они в `try/except`; но реализуй Task 7 до прогона, чтобы импорт не падал в логах.)

- [ ] **Step 4: PASS**
Run: `cd backend && python -m pytest tests/test_form_dispatch.py::test_token_submit_attaches_to_existing_candidate -v`

---

## Task 6: Эндпоинты карточки — список отправок, бейдж, «прочитано»

**Files:**
- Modify: `backend/api/routes/forms.py`
- Test: `backend/tests/test_form_dispatch.py`

- [ ] **Step 1: Тест бейджа**
```python
@pytest.mark.asyncio
async def test_unread_count_and_mark_seen(client, db_session, organization, admin_user, org_owner):
    form = FormTemplate(org_id=organization.id, created_by=admin_user.id, title="S", slug="scr-4", fields=[])
    entity = Entity(org_id=organization.id, type=EntityType.candidate, name="Анна", status=EntityStatus.new)
    db_session.add_all([form, entity])
    await db_session.flush()
    db_session.add(FormDispatch(form_id=form.id, entity_id=entity.id, token="t-unread",
                                status="submitted", seen_by_recruiter=False, created_by=admin_user.id))
    await db_session.commit()

    r = await client.get(f"/api/forms/entity/{entity.id}/unread-count", headers=_headers(admin_user))
    assert r.status_code == 200 and r.json()["count"] == 1

    r = await client.patch(f"/api/forms/entity/{entity.id}/dispatches/seen", headers=_headers(admin_user))
    assert r.status_code == 200

    r = await client.get(f"/api/forms/entity/{entity.id}/unread-count", headers=_headers(admin_user))
    assert r.json()["count"] == 0
```

- [ ] **Step 2: FAIL**
Run: `cd backend && python -m pytest tests/test_form_dispatch.py::test_unread_count_and_mark_seen -v`

- [ ] **Step 3: Реализация** (добавить `update` к импорту sqlalchemy в forms.py — он уже импортирован):
```python
async def _assert_entity_access(entity_id: int, current_user: User, db: AsyncSession) -> Entity:
    entity = (await db.execute(select(Entity).where(Entity.id == entity_id))).scalar_one_or_none()
    if not entity:
        raise HTTPException(status_code=404, detail="Candidate not found")
    if current_user.role != UserRole.superadmin:
        org = await get_user_org(current_user, db)
        if not org or entity.org_id != org.id:
            raise HTTPException(status_code=403, detail="Access denied")
    return entity


@router.get("/entity/{entity_id}/dispatches")
async def list_entity_dispatches(entity_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    current_user = await db.merge(current_user)
    await _assert_entity_access(entity_id, current_user, db)
    rows = (await db.execute(
        select(FormDispatch).where(FormDispatch.entity_id == entity_id).order_by(FormDispatch.created_at.desc())
    )).scalars().all()
    form_ids = {d.form_id for d in rows}
    titles = {}
    if form_ids:
        for fid, title in (await db.execute(select(FormTemplate.id, FormTemplate.title).where(FormTemplate.id.in_(form_ids)))).all():
            titles[fid] = title
    subs = {}
    sub_ids = [d.submission_id for d in rows if d.submission_id]
    if sub_ids:
        for s in (await db.execute(select(FormSubmission).where(FormSubmission.id.in_(sub_ids)))).scalars().all():
            subs[s.id] = s.data
    return [{
        "id": d.id, "form_id": d.form_id, "form_title": titles.get(d.form_id), "token": d.token,
        "status": d.status, "seen_by_recruiter": d.seen_by_recruiter,
        "submission_id": d.submission_id, "answers": subs.get(d.submission_id),
        "created_at": d.created_at.isoformat() if d.created_at else None,
        "submitted_at": d.submitted_at.isoformat() if d.submitted_at else None,
    } for d in rows]


@router.get("/entity/{entity_id}/unread-count")
async def entity_forms_unread_count(entity_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    current_user = await db.merge(current_user)
    await _assert_entity_access(entity_id, current_user, db)
    count = (await db.execute(
        select(func.count(FormDispatch.id)).where(
            FormDispatch.entity_id == entity_id,
            FormDispatch.status == "submitted",
            FormDispatch.seen_by_recruiter == False,  # noqa: E712
        )
    )).scalar() or 0
    return {"count": count}


@router.patch("/entity/{entity_id}/dispatches/seen")
async def mark_entity_dispatches_seen(entity_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    current_user = await db.merge(current_user)
    await _assert_entity_access(entity_id, current_user, db)
    await db.execute(
        update(FormDispatch).where(
            FormDispatch.entity_id == entity_id,
            FormDispatch.seen_by_recruiter == False,  # noqa: E712
        ).values(seen_by_recruiter=True)
    )
    await db.commit()
    return {"ok": True}
```

- [ ] **Step 4: PASS**
Run: `cd backend && python -m pytest tests/test_form_dispatch.py::test_unread_count_and_mark_seen -v`

---

## Task 7: WS-broadcast + нотификация о сабмите

**Files:**
- Modify: `backend/api/routes/realtime.py` (после `broadcast_call_failed`, ~строка 605)
- Modify: `backend/api/services/hr_notifications.py` (после `notify_new_candidate`)
- Test: `backend/tests/test_form_dispatch.py`

- [ ] **Step 1: Тест — сабмит создаёт Notification для отправителя**
```python
from api.models.database import Notification


@pytest.mark.asyncio
async def test_submit_creates_notification(client, db_session, organization, admin_user, second_user):
    form = FormTemplate(org_id=organization.id, created_by=admin_user.id, title="S", slug="scr-5", fields=[])
    entity = Entity(org_id=organization.id, type=EntityType.candidate, name="Анна", status=EntityStatus.new)
    db_session.add_all([form, entity])
    await db_session.flush()
    db_session.add(FormDispatch(form_id=form.id, entity_id=entity.id, token="t-notif", created_by=second_user.id))
    await db_session.commit()

    await client.post("/api/forms/public/d/t-notif/submit", json={"data": {}})
    notifs = (await db_session.execute(
        select(Notification).where(Notification.user_id == second_user.id, Notification.type == "form_submitted")
    )).scalars().all()
    assert len(notifs) == 1
    assert "анкет" in notifs[0].title.lower()
```

- [ ] **Step 2: FAIL**
Run: `cd backend && python -m pytest tests/test_form_dispatch.py::test_submit_creates_notification -v`

- [ ] **Step 3a: `broadcast_form_submission` в `realtime.py`**
```python
async def broadcast_form_submission(org_id: int, payload: Dict[str, Any]):
    """Broadcast form.submission event to organization."""
    await manager.broadcast_to_org(org_id, "form.submission", payload)
```

- [ ] **Step 3b: `notify_form_submitted` в `hr_notifications.py`**
```python
async def notify_form_submitted(db: AsyncSession, dispatch, entity, form) -> None:
    """Уведомить отправителя анкеты о полученном ответе кандидата."""
    try:
        if not dispatch.created_by:
            return
        title = "Ответ на анкету"
        cand = entity.name if entity else "Кандидат"
        message = f"{cand} заполнил(а) анкету «{form.title}»"
        link = "/all-candidates"
        await _create_notification(db, dispatch.created_by, "form_submitted", title, message, link)
        await db.commit()
    except Exception:
        logger.exception("notify_form_submitted failed")
        await db.rollback()
```

- [ ] **Step 4: PASS** (и убедиться, что Task 5 уже импортирует обе функции)
Run: `cd backend && python -m pytest tests/test_form_dispatch.py -v`
Expected: все тесты файла PASS.

---

# FRONTEND

## Task 8: API-клиент форм — токен/отправки/бейдж + тип `scale`

**Files:**
- Modify: `frontend/src/services/api/forms.ts`

- [ ] **Step 1: Расширить тип `FormField`** (строка 12) — добавить `'scale'` и поля шкалы:
```typescript
export interface FormField {
  id: string;
  type: 'text' | 'email' | 'phone' | 'textarea' | 'select' | 'multiselect' | 'radio' | 'file' | 'url' | 'scale';
  label: string;
  required: boolean;
  placeholder?: string;
  options?: string[];
  min?: number;   // для scale
  max?: number;   // для scale
}
```

- [ ] **Step 2: Добавить типы и функции отправки/ответов** (в конец файла):
```typescript
export interface FormDispatchInfo {
  id: number; form_id: number; form_title: string | null; token: string;
  status: 'sent' | 'opened' | 'submitted'; seen_by_recruiter: boolean;
  submission_id: number | null; answers: Record<string, unknown> | null;
  created_at: string | null; submitted_at: string | null;
}

export const createDispatch = async (formId: number, entityId: number): Promise<{ token: string; url: string; id: number }> => {
  const { data } = await api.post(`/forms/${formId}/dispatch`, { entity_id: entityId });
  return data;
};

export const getEntityDispatches = async (entityId: number): Promise<FormDispatchInfo[]> => {
  const { data } = await api.get(`/forms/entity/${entityId}/dispatches`);
  return data;
};

export const getEntityFormsUnreadCount = async (entityId: number): Promise<{ count: number }> => {
  const { data } = await api.get(`/forms/entity/${entityId}/unread-count`);
  return data;
};

export const markEntityDispatchesSeen = async (entityId: number): Promise<void> => {
  await api.patch(`/forms/entity/${entityId}/dispatches/seen`);
};

export const getPublicFormByToken = async (token: string): Promise<PublicFormData & { candidate_name: string | null; already_submitted: boolean }> => {
  const { data } = await api.get(`/forms/public/d/${token}`);
  return data;
};

export const submitPublicFormByToken = async (token: string, formData: Record<string, unknown>): Promise<{ message: string }> => {
  const { data } = await api.post(`/forms/public/d/${token}/submit`, { data: formData });
  return data;
};
```

- [ ] **Step 3: Проверить компиляцию типов**
Run: `cd frontend && npx tsc --noEmit`
Expected: без новых ошибок в `forms.ts`.

---

## Task 9: Событие `form.submission` в WS-типах и хуке

**Files:**
- Modify: `frontend/src/types/websocket.ts`
- Modify: `frontend/src/hooks/useWebSocket.ts`

- [ ] **Step 1: `websocket.ts`** — добавить во все нужные места:
  1. В `WebSocketEventType` (строка 11) добавить `| 'form.submission'`.
  2. Новый payload:
```typescript
export interface FormSubmissionPayload {
  entity_id: number;
  form_id: number;
  dispatch_id: number;
  form_title: string;
  candidate_name: string | null;
}
```
  3. В `WebSocketPayload` (строка 114) добавить `| FormSubmissionPayload`.
  4. Новый message + в union `WebSocketMessage` (строка 193):
```typescript
export interface FormSubmissionMessage extends BaseWebSocketMessage {
  type: 'form.submission';
  payload: FormSubmissionPayload;
}
```
  5. В `WebSocketEventHandlers` (строка 210) добавить `onFormSubmission?: (data: FormSubmissionPayload) => void;`

- [ ] **Step 2: `useWebSocket.ts`** — деструктурировать `onFormSubmission` (строка ~47), добавить в зависимости `connect` (строка 219) и добавить case в switch (после `chat.message`, строка 201):
```typescript
            case 'form.submission':
              onFormSubmission?.(message.payload);
              break;
```

- [ ] **Step 3: Проверка типов** (exhaustiveness-check должен снова стать валидным)
Run: `cd frontend && npx tsc --noEmit`
Expected: без ошибок exhaustiveness в `useWebSocket.ts`.

---

## Task 10: Сторы — мгновенный Inbox + per-entity бейдж

**Files:**
- Create: `frontend/src/stores/notificationStore.ts`
- Create: `frontend/src/stores/formBadgeStore.ts`
- Test: `frontend/src/stores/__tests__/formBadgeStore.test.ts`

- [ ] **Step 1: Тест per-entity стора**
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { useFormBadgeStore } from '../formBadgeStore';

describe('formBadgeStore', () => {
  beforeEach(() => useFormBadgeStore.setState({ counts: {} }));

  it('sets and bumps per-entity count', () => {
    useFormBadgeStore.getState().setCount(7, 2);
    expect(useFormBadgeStore.getState().counts[7]).toBe(2);
    useFormBadgeStore.getState().bump(7);
    expect(useFormBadgeStore.getState().counts[7]).toBe(3);
    useFormBadgeStore.getState().clear(7);
    expect(useFormBadgeStore.getState().counts[7]).toBe(0);
  });
});
```

- [ ] **Step 2: FAIL**
Run: `cd frontend && npx vitest run src/stores/__tests__/formBadgeStore.test.ts`

- [ ] **Step 3: Реализация `formBadgeStore.ts`**
```typescript
import { create } from 'zustand';

interface FormBadgeState {
  counts: Record<number, number>;
  setCount: (entityId: number, count: number) => void;
  bump: (entityId: number) => void;
  clear: (entityId: number) => void;
}

export const useFormBadgeStore = create<FormBadgeState>((set) => ({
  counts: {},
  setCount: (entityId, count) => set((s) => ({ counts: { ...s.counts, [entityId]: count } })),
  bump: (entityId) => set((s) => ({ counts: { ...s.counts, [entityId]: (s.counts[entityId] || 0) + 1 } })),
  clear: (entityId) => set((s) => ({ counts: { ...s.counts, [entityId]: 0 } })),
}));
```

- [ ] **Step 4: Реализация `notificationStore.ts`** (глобальный счётчик колокольчика)
```typescript
import { create } from 'zustand';

interface NotificationState {
  unreadCount: number;
  setUnreadCount: (n: number) => void;
  bumpUnread: () => void;
}

export const useNotificationStore = create<NotificationState>((set) => ({
  unreadCount: 0,
  setUnreadCount: (n) => set({ unreadCount: Math.max(0, n) }),
  bumpUnread: () => set((s) => ({ unreadCount: s.unreadCount + 1 })),
}));
```

- [ ] **Step 5: PASS**
Run: `cd frontend && npx vitest run src/stores/__tests__/formBadgeStore.test.ts`

---

## Task 11: Подписка WebSocketProvider + перенос счётчика Inbox в стор

**Files:**
- Modify: `frontend/src/components/WebSocketProvider.tsx`
- Modify: `frontend/src/components/Layout.tsx` (счётчик колокольчика ~строки 936, 944-951, 1006-1012)

- [ ] **Step 1: `WebSocketProvider.tsx`** — импортировать сторы и добавить обработчик:
```typescript
import { useFormBadgeStore } from '@/stores/formBadgeStore';
import { useNotificationStore } from '@/stores/notificationStore';
```
В теле компонента:
```typescript
  const bumpEntityBadge = useFormBadgeStore((s) => s.bump);
  const bumpUnread = useNotificationStore((s) => s.bumpUnread);
```
В объект опций `useWebSocket({ ... })` добавить:
```typescript
    onFormSubmission: (p) => {
      bumpEntityBadge(p.entity_id);
      bumpUnread();
    },
```

- [ ] **Step 2: `Layout.tsx`** — связать колокольчик со стором.
  - Импорт: `import { useNotificationStore } from '@/stores/notificationStore';`
  - Заменить локальный `const [unreadCount, setUnreadCount] = useState(0);` (строка 936) на:
```typescript
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const setUnreadCount = useNotificationStore((s) => s.setUnreadCount);
```
  - В `fetchUnreadCount` (строка 946-947) оставить `setUnreadCount(result.count);` — он теперь пишет в стор. Поллинг (строка 1006-1012) и `markAllRead`/`markRead` остаются; их `setUnreadCount(...)` тоже работают через стор. Так колокольчик обновляется мгновенно по WS (`bumpUnread`) и сверяется поллингом раз в 30с.

- [ ] **Step 3: Проверка типов и сборки**
Run: `cd frontend && npx tsc --noEmit`
Expected: без ошибок.

---

## Task 12: Бейдж с числом в `HuntflowActionChip`

**Files:**
- Modify: `frontend/src/components/hr/HuntflowControls.tsx` (тип `HuntflowActionChipProps` строка 80, рендер строка ~123)

- [ ] **Step 1: Добавить prop** `notificationCount?: number;` в `HuntflowActionChipProps` (после `hasNotification`).
- [ ] **Step 2: Деструктурировать** `notificationCount` в сигнатуре (строка ~100).
- [ ] **Step 3: Рендер числового бейджа** — внутри `<span className="hf-action-chip-icon">` после блока `hasNotification` (строка 127):
```tsx
        {!loading && typeof notificationCount === 'number' && notificationCount > 0 && (
          <span className="hf-action-chip-badge" aria-label={`${notificationCount} новых ответов`}>
            {notificationCount > 9 ? '9+' : notificationCount}
          </span>
        )}
```
- [ ] **Step 4: Стиль** — в соответствующем CSS (искать `.hf-action-chip-icon` / `.hf-action-chip-unavailable` в `frontend/src/**/*.css`) добавить класс `.hf-action-chip-badge` (красный кружок, позиционируется как `.hf-action-chip-unavailable`). Скопировать позиционирование с `.hf-action-chip-unavailable`, заменив содержимое на числовой бейдж (фон `#e11d48`, белый текст, `min-width:16px`, `border-radius:999px`, `font-size:11px`).
- [ ] **Step 5: Проверка**
Run: `cd frontend && npx tsc --noEmit`

---

## Task 13: Вынести `<FormBuilder>` из `FormBuilderPage`

**Files:**
- Create: `frontend/src/features/forms/FormBuilder.tsx`
- Modify: `frontend/src/pages/FormBuilderPage.tsx`

- [ ] **Step 1:** Создать `frontend/src/features/forms/FormBuilder.tsx`. Перенести туда компонент `FormEditView` из `FormBuilderPage.tsx` (строки ~213 до конца компонента) **без изменений логики**, переименовав в `FormBuilder` и заменив зависимость от роутера на колбэк. Новая сигнатура:
```typescript
export function FormBuilder({ formId, onClose }: { formId: number; onClose: () => void }) {
```
  Внутри: заменить все вызовы `navigate('/form-builder')` на `onClose()`. Убрать `const navigate = useNavigate();` если он больше не используется. Перенести вспомогательные функции `nextFieldId`, `fieldWord`, `submissionWord`, `FIELD_TYPES`, `TYPE_LABELS`, если `FormEditView` их использует (продублировать импорт типов из `@/services/api/forms`).

- [ ] **Step 2:** В `FormBuilderPage.tsx` импортировать вынесенный компонент и использовать его в ветке редактирования:
```typescript
import { FormBuilder } from '@/features/forms/FormBuilder';
// ...в рендере, где раньше был <FormEditView formId={...} />:
<FormBuilder formId={formId} onClose={() => navigate('/form-builder')} />
```
  Удалить старое определение `FormEditView` из `FormBuilderPage.tsx`.

- [ ] **Step 3: Проверка — страница `/form-builder` всё ещё работает**
Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: сборка проходит. (Ручная проверка `/form-builder/:id` — в Task 18.)

---

## Task 14: Тип поля «Шкала» в билдере и публичном рендере

**Files:**
- Modify: `frontend/src/features/forms/FormBuilder.tsx` (массив `FIELD_TYPES` и настройки поля)
- Modify: `frontend/src/pages/PublicFormPage.tsx` (`FormFieldRenderer`)

- [ ] **Step 1:** В `FIELD_TYPES` (перенесён в FormBuilder) добавить пункт `{ type: 'scale', label: 'Шкала', icon: <подходящая lucide-иконка, напр. SlidersHorizontal или Star> }` и импортировать иконку из `lucide-react`. В `TYPE_LABELS` добавить `scale: 'Шкала'`. В UI настроек поля для `type === 'scale'` показать два числовых инпута `min`/`max` (дефолт 1 и 10), пишущих в `field.min`/`field.max`.
- [ ] **Step 2:** В `PublicFormPage.tsx` в `FormFieldRenderer` добавить ветку рендера (после `url`, перед `file`):
```tsx
      {field.type === 'scale' && (
        <div className="flex flex-wrap gap-2 mt-1">
          {Array.from({ length: (field.max ?? 10) - (field.min ?? 1) + 1 }, (_, i) => (field.min ?? 1) + i).map(n => (
            <button
              type="button"
              key={n}
              onClick={() => onChange(n)}
              className={`w-10 h-10 rounded-full border text-sm transition-colors ${
                value === n ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600 hover:border-blue-400'
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      )}
```
- [ ] **Step 3:** В `PublicFormPage` инициализацию дефолтов (строки 28-36) дополнить: для `scale` — `defaults[field.id] = null;` (число выбирается кликом).
- [ ] **Step 4: Проверка**
Run: `cd frontend && npx tsc --noEmit`

---

## Task 15: Сид-пресеты шаблонов

**Files:**
- Create: `frontend/src/features/forms/formTemplates.ts`

- [ ] **Step 1:** Создать пресеты (используются в шаге «Из шаблона»):
```typescript
import type { FormField } from '@/services/api/forms';

export interface AnketaTemplate { key: string; title: string; description: string; fields: Omit<FormField, 'id'>[]; }

export const ANKETA_TEMPLATES: AnketaTemplate[] = [
  {
    key: 'screening', title: 'Скрининг-анкета', description: 'Базовый отбор кандидата',
    fields: [
      { type: 'text', label: 'ФИО', required: true },
      { type: 'phone', label: 'Телефон', required: true },
      { type: 'email', label: 'Email', required: true },
      { type: 'scale', label: 'Оцените свой уровень для этой роли', required: false, min: 1, max: 10 },
      { type: 'textarea', label: 'Почему вам интересна вакансия?', required: false },
    ],
  },
  {
    key: 'tech', title: 'Тех-анкета', description: 'Технический скрининг',
    fields: [
      { type: 'text', label: 'ФИО', required: true },
      { type: 'multiselect', label: 'Стек', required: false, options: ['Python', 'JavaScript', 'Go', 'Java', 'C#'] },
      { type: 'scale', label: 'Опыт с основным языком (лет)', required: false, min: 1, max: 10 },
      { type: 'url', label: 'GitHub / портфолио', required: false },
    ],
  },
  {
    key: 'preoffer', title: 'Pre-offer', description: 'Перед оффером',
    fields: [
      { type: 'text', label: 'ФИО', required: true },
      { type: 'text', label: 'Ожидания по зарплате', required: true },
      { type: 'radio', label: 'Готовность к релокации', required: false, options: ['Да', 'Нет', 'Обсуждается'] },
      { type: 'text', label: 'Желаемая дата выхода', required: false },
    ],
  },
];
```

---

## Task 16: Шторка `AnketaDrawer` (radix Dialog, lazy)

**Files:**
- Create: `frontend/src/features/forms/AnketaDrawer.tsx`

- [ ] **Step 1:** Создать `AnketaDrawer.tsx` — правый Drawer на `@radix-ui/react-dialog` с шагами: вход (3 пути) → конструктор/шаблон → ответы. Структура:
```tsx
import { useState, useEffect, useCallback } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import toast from 'react-hot-toast';
import { Plus, LayoutGrid, Sparkles, X, Copy, Send, Inbox } from 'lucide-react';
import { FormBuilder } from './FormBuilder';
import { ANKETA_TEMPLATES } from './formTemplates';
import {
  createForm, createDispatch, getEntityDispatches, markEntityDispatchesSeen,
  type FormDispatchInfo,
} from '@/services/api/forms';
import { useFormBadgeStore } from '@/stores/formBadgeStore';

type Step = 'entry' | 'builder' | 'responses';

export function AnketaDrawer({
  open, onOpenChange, entityId, entityName,
}: { open: boolean; onOpenChange: (v: boolean) => void; entityId: number; entityName: string }) {
  const [step, setStep] = useState<Step>('entry');
  const [formId, setFormId] = useState<number | null>(null);
  const [dispatches, setDispatches] = useState<FormDispatchInfo[]>([]);
  const clearBadge = useFormBadgeStore((s) => s.clear);

  const loadDispatches = useCallback(async () => {
    setDispatches(await getEntityDispatches(entityId));
  }, [entityId]);

  useEffect(() => {
    if (open) { loadDispatches(); }
    else { setStep('entry'); setFormId(null); }
  }, [open, loadDispatches]);

  const openResponses = async () => {
    await markEntityDispatchesSeen(entityId);
    clearBadge(entityId);
    await loadDispatches();
    setStep('responses');
  };

  const startBlank = async () => {
    const form = await createForm({ title: `Анкета — ${entityName}`, fields: [
      { id: `f${Date.now()}`, type: 'text', label: 'ФИО', required: true },
    ] });
    setFormId(form.id); setStep('builder');
  };

  const startFromTemplate = async (tplKey: string) => {
    const tpl = ANKETA_TEMPLATES.find(t => t.key === tplKey)!;
    const form = await createForm({
      title: `${tpl.title} — ${entityName}`,
      fields: tpl.fields.map((f, i) => ({ ...f, id: `f${Date.now()}_${i}` })),
    });
    setFormId(form.id); setStep('builder');
  };

  const sendToCandidate = async () => {
    if (!formId) return;
    const { url } = await createDispatch(formId, entityId);
    const full = `${window.location.origin}${url}`;
    await navigator.clipboard.writeText(full);
    toast.success('Персональная ссылка скопирована');
    await loadDispatches();
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-40" />
        <Dialog.Content className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-3xl bg-white shadow-xl flex flex-col">
          <div className="flex items-center justify-between border-b px-5 py-3">
            <Dialog.Title className="text-base font-semibold">Анкета · {entityName}</Dialog.Title>
            <div className="flex items-center gap-2">
              <button onClick={openResponses} className="text-sm text-gray-500 hover:text-gray-900 flex items-center gap-1">
                <Inbox className="w-4 h-4" /> Ответы
              </button>
              <Dialog.Close className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></Dialog.Close>
            </div>
          </div>
          <div className="flex-1 overflow-auto">
            {step === 'entry' && (
              <EntryStep onBlank={startBlank} onTemplate={startFromTemplate} />
            )}
            {step === 'builder' && formId && (
              <>
                <FormBuilder formId={formId} onClose={() => setStep('entry')} />
                <div className="sticky bottom-0 bg-white border-t px-5 py-3 flex justify-end gap-2">
                  <button onClick={sendToCandidate} className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm">
                    <Send className="w-4 h-4" /> Отправить кандидату
                  </button>
                </div>
              </>
            )}
            {step === 'responses' && (
              <ResponsesStep dispatches={dispatches} />
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```
  Дописать вспомогательные подкомпоненты в этом же файле:
  - `EntryStep` — три карточки: «С нуля» (`onBlank`), «Из шаблона» (рендер `ANKETA_TEMPLATES` → `onTemplate(key)`), «AI-генерация» — кнопка `disabled` с подписью «Скоро».
  - `ResponsesStep` — список `dispatches`: статус, дата, ссылка (кнопка copy), и при `answers` — пары «label: value» (label берётся из формы по `field.id`; для MVP можно показать `key: value` из `answers`).

- [ ] **Step 2: Проверка типов**
Run: `cd frontend && npx tsc --noEmit`

---

## Task 17: Кнопка «Анкета» с бейджем на карточке + lazy-mount шторки

**Files:**
- Modify: `frontend/src/pages/AllCandidatesPage.tsx` (импорты строка ~65; ряд чипов строки ~2567-2590)

- [ ] **Step 1:** Вверху файла добавить ленивый импорт и иконку:
```typescript
import { lazy, Suspense } from 'react'; // если ещё не импортированы
import { ClipboardList } from 'lucide-react';
const AnketaDrawer = lazy(() => import('@/features/forms/AnketaDrawer').then(m => ({ default: m.AnketaDrawer })));
import { useFormBadgeStore } from '@/stores/formBadgeStore';
import { getEntityFormsUnreadCount } from '@/services/api/forms';
```

- [ ] **Step 2:** В компоненте карточки (где доступен `card`/entity с `id` и `name`) добавить состояние и подгрузку счётчика:
```typescript
const [anketaOpen, setAnketaOpen] = useState(false);
const anketaCount = useFormBadgeStore((s) => s.counts[card.id] ?? 0);
const setAnketaCount = useFormBadgeStore((s) => s.setCount);
useEffect(() => {
  getEntityFormsUnreadCount(card.id).then(r => setAnketaCount(card.id, r.count)).catch(() => {});
}, [card.id, setAnketaCount]);
```

- [ ] **Step 3:** В ряд чипов (рядом с `ActionChip` «Оффер», строка ~2581) добавить чип «Анкета»:
```tsx
<ActionChip
  icon={ClipboardList}
  label="Анкета"
  notificationCount={anketaCount}
  onClick={() => setAnketaOpen(true)}
/>
```

- [ ] **Step 4:** В конце JSX карточки смонтировать шторку под Suspense:
```tsx
{anketaOpen && (
  <Suspense fallback={null}>
    <AnketaDrawer open={anketaOpen} onOpenChange={setAnketaOpen} entityId={card.id} entityName={card.name} />
  </Suspense>
)}
```

- [ ] **Step 5: Проверка типов/сборки**
Run: `cd frontend && npx tsc --noEmit && npm run build`

---

## Task 18: Публичный роут по токену `/form/d/:token`

**Files:**
- Modify: `frontend/src/pages/PublicFormPage.tsx`
- Modify: `frontend/src/App.tsx` (строка 176, рядом с `/form/:slug`)

- [ ] **Step 1:** В `PublicFormPage.tsx` поддержать оба источника. Заменить `const { slug } = useParams...` на:
```typescript
const { slug, token } = useParams<{ slug?: string; token?: string }>();
```
  В загрузке (useEffect, строки 21-43) и в `handleSubmit` (строки 67-86) ветвление:
```typescript
// загрузка
const data = token ? await getPublicFormByToken(token) : await getPublicForm(slug!);
// submit (файлы в токен-режиме MVP-1 не обязательны — если есть file-поля, оставляем slug-ветку как есть)
if (token) {
  await submitPublicFormByToken(token, values);
} else if (files.length > 0) {
  await submitPublicFormWithFiles(slug!, values, files);
} else {
  await submitPublicForm(slug!, values);
}
```
  Импортировать `getPublicFormByToken, submitPublicFormByToken` из `@/services/api/forms`. Гард в useEffect заменить `if (!slug) return;` на `if (!slug && !token) return;` и зависимость `[slug, token]`.

- [ ] **Step 2:** В `App.tsx` после строки 176 добавить роут:
```tsx
<Route path="/form/d/:token" element={<Suspense fallback={<PageLoader />}><PublicFormPage /></Suspense>} />
```

- [ ] **Step 3: Проверка типов/сборки**
Run: `cd frontend && npx tsc --noEmit && npm run build`

---

## Task 19: Ручная сквозная проверка (e2e вручную)

- [ ] **Step 1:** Запустить backend и frontend:
Run: `cd backend && uvicorn main:app --reload` и в другом терминале `cd frontend && npm run dev`
- [ ] **Step 2:** Открыть карточку кандидата → кнопка «Анкета» → «Из шаблона» → «Скрининг-анкета» → проверить, что поля (включая «Шкала») редактируются.
- [ ] **Step 3:** «Отправить кандидату» → ссылка скопирована. Открыть её в приватном окне (без авторизации) → форма открывается с именем кандидата → заполнить шкалу/поля → «Отправить».
- [ ] **Step 4:** Вернуться в карточку (та же сессия HR): на кнопке «Анкета» загорается бейдж `1` (мгновенно по WS, без перезагрузки), колокольчик Inbox инкрементится.
- [ ] **Step 5:** Открыть шторку → «Ответы» → виден ответ; бейдж гаснет (mark-seen). Проверить, что НОВЫЙ кандидат в «Все кандидаты» не появился (ответ привязан к существующему).
- [ ] **Step 6:** Прогнать все тесты:
Run: `cd backend && python -m pytest tests/test_form_dispatch.py -v` и `cd frontend && npx vitest run`
Expected: всё зелёное.

---

# WYSIWYG BUILDER UPGRADE (MVP-1 — Survio-parity, решение пользователя 2026-06-18)

Билдер MVP-1 поднимается с простого «палитра + список карточек» до **Survio-style WYSIWYG**. Контракт `FormBuilder({ formId, onClose })` сохраняется (шторка из карточки и роут `/form-builder` не трогаются). Сохраняется вся логика загрузки/сохранения/состояния (`getForm`/`updateForm`, fields/title/description/isActive, мультивыбор воронок, просмотр ответов). AI-чат, доп. типы, каналы, аналитика остаются MVP-2/3.

**WYSIWYG-спека:**
- каждый вопрос рендерится «как видит кандидат» (переиспользуем публичный рендерер поля);
- hover-тулбар у вопроса: drag-порядок · настройки · дублировать · удалить;
- inline «+» между вопросами → модалка «Добавить вопрос» (группы Базовые/Открытые/Оценочные, наши 10 типов вкл. «Шкала»);
- настройки поля: заголовок, обязательность, placeholder, опции (add/remove), min/max для шкалы.

### Task 20: Вынести общий `FieldRenderer`
**Files:** Create `frontend/src/features/forms/FieldRenderer.tsx` (перенести `FormFieldRenderer` из `PublicFormPage.tsx`, экспортировать как `FieldRenderer` — со всеми ветками типов, включая `scale`); Modify `frontend/src/pages/PublicFormPage.tsx` (импортировать и использовать его вместо локального). Поведение публичной формы не меняется. Verify: `cd frontend && npx tsc --noEmit && npm run build`. Билдер переиспользует его (обёрнутым в `pointer-events-none`) для настоящего WYSIWYG-превью.

### Task 21: Переписать `FormBuilder.tsx` на WYSIWYG
**Files:** Modify `frontend/src/features/forms/FormBuilder.tsx`. Сохранить экспорты (`FIELD_TYPES`, `TYPE_LABELS`, `nextFieldId`, `fieldWord`, `submissionWord`, `FormBuilder`) и всю load/save/state-логику. Заменить UI поля-списка на WYSIWYG-холст: превью через `FieldRenderer`, hover-тулбар, inline «+», модалка-тайпикер, настройки поля. Светлый холст (как у кандидата) поверх любого фона. Verify: `cd frontend && npx tsc --noEmit && npm run build`. Новый файл `FieldRenderer.tsx` добавляется в коммит-группу #4.

## Коммиты (выполнять ТОЛЬКО после команды «Пуш»)

Стейджить строго перечисленные файлы (никаких `git add -A`). Логические коммиты:

```bash
# 1. backend data + миграция
git add backend/api/models/database.py backend/alembic/versions/add_form_dispatches.py backend/start.sh
git commit -m "feat(forms): модель form_dispatches + dispatch_id, миграция и safety-net"

# 2. backend API + realtime + нотификации + тесты
git add backend/api/routes/forms.py backend/api/routes/realtime.py backend/api/services/hr_notifications.py backend/tests/test_form_dispatch.py
git commit -m "feat(forms): персональная отправка анкеты, привязка ответа, бейдж, WS form.submission"

# 3. frontend инфраструктура (api, ws, сторы, чип)
git add frontend/src/services/api/forms.ts frontend/src/types/websocket.ts frontend/src/hooks/useWebSocket.ts frontend/src/stores/notificationStore.ts frontend/src/stores/formBadgeStore.ts frontend/src/stores/__tests__/formBadgeStore.test.ts frontend/src/components/WebSocketProvider.tsx frontend/src/components/Layout.tsx frontend/src/components/hr/HuntflowControls.tsx
git commit -m "feat(forms): WS form.submission, мгновенный Inbox и per-entity бейдж на кнопке"

# 4. frontend фича (билдер/шторка/публичная форма)
git add frontend/src/features/forms/FormBuilder.tsx frontend/src/features/forms/AnketaDrawer.tsx frontend/src/features/forms/formTemplates.ts frontend/src/pages/FormBuilderPage.tsx frontend/src/pages/PublicFormPage.tsx frontend/src/pages/AllCandidatesPage.tsx frontend/src/App.tsx
git commit -m "feat(forms): шторка-конструктор из карточки, шкала, шаблоны, публичный роут по токену"
```
Заканчивать каждое сообщение коммита строкой:
`Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

После пуша: пользователь жмёт Deploy в Coolify (автодеплой сломан); проверка на проде — Ctrl+Shift+R.

---

## Self-review (выполнено при написании плана)

- **Покрытие спеки:** `form_dispatches`+`dispatch_id` (T1-2) ✓; dispatch (T3) ✓; public-by-token GET/submit (T4-5) ✓; entity-dispatches/unread/seen (T6) ✓; WS `form.submission`+Notification (T7,T9,T11) ✓; тип `scale` (T8,T14) ✓; вынос билдера (T13) ✓; AnketaDrawer lazy из кнопки (T16-17) ✓; бейдж (T10,T12,T17) ✓; `/form/d/:token` (T18) ✓; сид-пресеты (T15) ✓. Оба режима сохранены: slug-роуты `forms.py` не тронуты. AI/свои шаблоны — НЕ включены (MVP-2) ✓.
- **Плейсхолдеры:** единственное намеренное «вставь значение» — `down_revision` head из `alembic heads` (определяется во время выполнения, не угадывается) + точечный CSS-класс бейджа (адаптируется к существующему файлу стилей).
- **Согласованность имён:** `broadcast_form_submission`, `notify_form_submitted`, событие `form.submission`, store `useFormBadgeStore`/`useNotificationStore` — используются одинаково во всех задачах.
