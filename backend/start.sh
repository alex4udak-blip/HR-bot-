#!/bin/bash
set -e

echo "=== Starting HR-Bot Backend ==="

# Run migrations
echo "Running database migrations..."
python -m alembic upgrade head || echo "Migrations completed or skipped"

# Ensure critical columns exist (fallback for broken migration chain)
echo "Ensuring shadow users columns exist..."
python -c "
import os
import asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

async def ensure_shadow_columns():
    db_url = os.environ.get('DATABASE_URL', '')
    if not db_url:
        print('No DATABASE_URL, skipping column check')
        return

    # Convert postgres:// to postgresql+asyncpg://
    if db_url.startswith('postgres://'):
        db_url = db_url.replace('postgres://', 'postgresql+asyncpg://', 1)
    elif db_url.startswith('postgresql://'):
        db_url = db_url.replace('postgresql://', 'postgresql+asyncpg://', 1)

    engine = create_async_engine(db_url)
    # На свежей БД (например, первый деплой на новый Postgres-инстанс) таблиц
    # ещё нет — Base.metadata.create_all отработает в init_database() уже
    # после старта сервера. Если ALTER TABLE users тут упадёт, вся
    # транзакция откатится и оставшиеся ALTER не применятся. Поэтому
    # пропускаем весь блок если 'users' нет в БД.
    async with engine.begin() as bootstrap_conn:
        check = await bootstrap_conn.execute(text(
            \"SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users')\"
        ))
        if not check.scalar():
            print('Fresh database (no users table yet) — skipping column-check, init_database will create everything')
            await engine.dispose()
            return
    async with engine.begin() as conn:
        # Check and add is_shadow column
        result = await conn.execute(text(
            \"SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'is_shadow')\"
        ))
        if not result.scalar():
            print('Adding is_shadow column...')
            await conn.execute(text('ALTER TABLE users ADD COLUMN is_shadow BOOLEAN NOT NULL DEFAULT false'))

        # Check and add shadow_owner_id column
        result = await conn.execute(text(
            \"SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'shadow_owner_id')\"
        ))
        if not result.scalar():
            print('Adding shadow_owner_id column...')
            await conn.execute(text('ALTER TABLE users ADD COLUMN shadow_owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL'))

        # Check and add file_data column to entity_files (bytea for DB file storage)
        result = await conn.execute(text(
            \"SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'entity_files' AND column_name = 'file_data')\"
        ))
        if not result.scalar():
            print('Adding file_data column to entity_files...')
            await conn.execute(text('ALTER TABLE entity_files ADD COLUMN file_data BYTEA'))

        # Make file_path nullable (no longer required with DB storage)
        await conn.execute(text('ALTER TABLE entity_files ALTER COLUMN file_path DROP NOT NULL'))

        # Check and add file_data column to task_attachments (bytea for DB file storage)
        # Railway /tmp эфемерный — без этой колонки модель ломает любой запрос
        # к task_attachments (kanban 500).
        result = await conn.execute(text(
            \"SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'task_attachments' AND column_name = 'file_data')\"
        ))
        if not result.scalar():
            print('Adding file_data column to task_attachments...')
            await conn.execute(text('ALTER TABLE task_attachments ADD COLUMN file_data BYTEA'))

        # Make task_attachments.storage_path nullable (no longer required with DB storage)
        await conn.execute(text('ALTER TABLE task_attachments ALTER COLUMN storage_path DROP NOT NULL'))

        # Check and add auto_tasks_enabled column to chats
        result = await conn.execute(text(
            \"SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'chats' AND column_name = 'auto_tasks_enabled')\"
        ))
        if not result.scalar():
            print('Adding auto_tasks_enabled column to chats...')
            await conn.execute(text('ALTER TABLE chats ADD COLUMN auto_tasks_enabled BOOLEAN DEFAULT false'))

        # Check and add remind_enabled column to chats
        result = await conn.execute(text(
            \"SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'chats' AND column_name = 'remind_enabled')\"
        ))
        if not result.scalar():
            print('Adding remind_enabled column to chats...')
            await conn.execute(text('ALTER TABLE chats ADD COLUMN remind_enabled BOOLEAN DEFAULT true'))

        # Check and add last_standup_at column to chats
        result = await conn.execute(text(
            \"SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'chats' AND column_name = 'last_standup_at')\"
        ))
        if not result.scalar():
            print('Adding last_standup_at column to chats...')
            await conn.execute(text('ALTER TABLE chats ADD COLUMN last_standup_at TIMESTAMP'))

        # Check and create time_off_requests table
        result = await conn.execute(text(
            \"SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'time_off_requests')\"
        ))
        if not result.scalar():
            print('Creating time_off_requests table...')
            await conn.execute(text(\"DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'timeofftype') THEN CREATE TYPE timeofftype AS ENUM ('vacation', 'day_off', 'sick_leave', 'other'); END IF; END \$\$\"))
            await conn.execute(text(\"DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'timeoffstatus') THEN CREATE TYPE timeoffstatus AS ENUM ('pending', 'approved', 'rejected'); END IF; END \$\$\"))
            await conn.execute(text('''
                CREATE TABLE time_off_requests (
                    id SERIAL PRIMARY KEY,
                    org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    type timeofftype DEFAULT 'vacation',
                    status timeoffstatus DEFAULT 'pending',
                    date_from TIMESTAMP NOT NULL,
                    date_to TIMESTAMP NOT NULL,
                    reason TEXT,
                    reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
                    reviewed_at TIMESTAMP,
                    reject_reason TEXT,
                    created_at TIMESTAMP DEFAULT now()
                )
            '''))
            await conn.execute(text('CREATE INDEX ix_timeoff_org_status ON time_off_requests (org_id, status)'))
            await conn.execute(text('CREATE INDEX ix_timeoff_user_status ON time_off_requests (user_id, status)'))

        # Check and create blockers table
        result = await conn.execute(text(
            \"SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'blockers')\"
        ))
        if not result.scalar():
            print('Creating blockers table...')
            await conn.execute(text(\"DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'blockerstatus') THEN CREATE TYPE blockerstatus AS ENUM ('open', 'resolved'); END IF; END \$\$\"))
            await conn.execute(text('''
                CREATE TABLE blockers (
                    id SERIAL PRIMARY KEY,
                    org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
                    description TEXT NOT NULL,
                    status blockerstatus DEFAULT 'open',
                    resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
                    resolved_at TIMESTAMP,
                    resolve_comment TEXT,
                    created_at TIMESTAMP DEFAULT now()
                )
            '''))
            await conn.execute(text('CREATE INDEX ix_blocker_org_status ON blockers (org_id, status)'))

        # Check and create entity_tags_catalog table
        result = await conn.execute(text(
            \"SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'entity_tags_catalog')\"
        ))
        if not result.scalar():
            print('Creating entity_tags_catalog table...')
            await conn.execute(text('''
                CREATE TABLE entity_tags_catalog (
                    id SERIAL PRIMARY KEY,
                    org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
                    name VARCHAR(100) NOT NULL,
                    color VARCHAR(20) NOT NULL DEFAULT '#3b82f6',
                    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
                    created_at TIMESTAMP DEFAULT now(),
                    CONSTRAINT uq_entity_tag_org_name UNIQUE (org_id, name)
                )
            '''))
            await conn.execute(text('CREATE INDEX ix_entity_tag_org ON entity_tags_catalog (org_id)'))

        # Check and create entity_tags association table
        result = await conn.execute(text(
            \"SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'entity_tags')\"
        ))
        if not result.scalar():
            print('Creating entity_tags association table...')
            await conn.execute(text('''
                CREATE TABLE entity_tags (
                    entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
                    tag_id INTEGER NOT NULL REFERENCES entity_tags_catalog(id) ON DELETE CASCADE,
                    PRIMARY KEY (entity_id, tag_id)
                )
            '''))

        # Check and add assigned_to column to vacancies (JSON array of recruiter user IDs)
        result = await conn.execute(text(
            \"SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vacancies' AND column_name = 'assigned_to')\"
        ))
        if not result.scalar():
            print('Adding assigned_to column to vacancies...')
            await conn.execute(text(\"ALTER TABLE vacancies ADD COLUMN assigned_to JSON DEFAULT '[]'\"))

        # Check and add assigned_to_all column to vacancies (visible to all HR users)
        result = await conn.execute(text(
            \"SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vacancies' AND column_name = 'assigned_to_all')\"
        ))
        if not result.scalar():
            print('Adding assigned_to_all column to vacancies...')
            await conn.execute(text('ALTER TABLE vacancies ADD COLUMN assigned_to_all BOOLEAN DEFAULT false'))

        # Check and add blocker_id column to project_tasks (link task → blocker)
        result = await conn.execute(text(
            \"SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'project_tasks' AND column_name = 'blocker_id')\"
        ))
        if not result.scalar():
            print('Adding blocker_id column to project_tasks...')
            await conn.execute(text('ALTER TABLE project_tasks ADD COLUMN blocker_id INTEGER REFERENCES blockers(id) ON DELETE SET NULL'))
            await conn.execute(text('CREATE INDEX ix_task_blocker ON project_tasks (blocker_id)'))

        # Org chart (оргсхема): org_units table + employees.org_unit_id / manager_id.
        # Их добавляет init_database(), но на проде он может не дойти до этого шага —
        # дублируем в safety-net, иначе SELECT employees падает (500).
        result = await conn.execute(text(
            \"SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'org_units')\"
        ))
        if not result.scalar():
            print('Creating org_units table...')
            await conn.execute(text('''
                CREATE TABLE org_units (
                    id SERIAL PRIMARY KEY,
                    org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
                    parent_id INTEGER REFERENCES org_units(id) ON DELETE CASCADE,
                    name VARCHAR(255) NOT NULL,
                    color VARCHAR(20),
                    sort_order INTEGER DEFAULT 0,
                    created_at TIMESTAMP DEFAULT now()
                )
            '''))
            await conn.execute(text('CREATE INDEX ix_org_units_org_id ON org_units (org_id)'))
            await conn.execute(text('CREATE INDEX ix_org_units_parent_id ON org_units (parent_id)'))

        result = await conn.execute(text(
            \"SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employees' AND column_name = 'org_unit_id')\"
        ))
        if not result.scalar():
            print('Adding org_unit_id column to employees...')
            await conn.execute(text('ALTER TABLE employees ADD COLUMN org_unit_id INTEGER REFERENCES org_units(id) ON DELETE SET NULL'))

        result = await conn.execute(text(
            \"SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employees' AND column_name = 'manager_id')\"
        ))
        if not result.scalar():
            print('Adding manager_id column to employees...')
            await conn.execute(text('ALTER TABLE employees ADD COLUMN manager_id INTEGER REFERENCES employees(id) ON DELETE SET NULL'))

        # Seed default email templates for all orgs
        result = await conn.execute(text('SELECT id FROM organizations'))
        org_ids = [r[0] for r in result.fetchall()]
        for oid in org_ids:
            # Welcome template
            exists = await conn.execute(text(
                \"SELECT 1 FROM email_templates WHERE org_id = :oid AND template_type = 'welcome' AND is_default = true\"
            ), {'oid': oid})
            if not exists.fetchone():
                print(f'Seeding welcome email template for org {oid}...')
                await conn.execute(text(\"\"\"
                    INSERT INTO email_templates (org_id, name, template_type, subject, body_html, body_text, is_active, is_default, variables, tags, created_at, updated_at)
                    VALUES (:oid, 'Приветственное письмо', 'welcome',
                        'Добро пожаловать в {{company_name}}!',
                        '<p>Здравствуйте, {{candidate_name}}!</p><p>Мы рады сообщить, что вы успешно прошли отбор на позицию <b>{{vacancy_title}}</b> в компании {{company_name}}.</p><p>Мы уверены, что ваш опыт и навыки станут ценным вкладом в нашу команду.</p><p>Если у вас есть вопросы, не стесняйтесь обращаться.</p><p>С уважением,<br>{{hr_name}}</p>',
                        'Здравствуйте, {{candidate_name}}! Мы рады сообщить, что вы успешно прошли отбор на позицию {{vacancy_title}} в компании {{company_name}}. С уважением, {{hr_name}}',
                        true, true,
                        '[\"candidate_name\", \"vacancy_title\", \"company_name\", \"hr_name\"]'::json,
                        '[]'::json, now(), now())
                \"\"\"), {'oid': oid})
            # Rejection template
            exists = await conn.execute(text(
                \"SELECT 1 FROM email_templates WHERE org_id = :oid AND template_type = 'rejection' AND is_default = true\"
            ), {'oid': oid})
            if not exists.fetchone():
                print(f'Seeding rejection email template for org {oid}...')
                await conn.execute(text(\"\"\"
                    INSERT INTO email_templates (org_id, name, template_type, subject, body_html, body_text, is_active, is_default, variables, tags, created_at, updated_at)
                    VALUES (:oid, 'Письмо-отказ', 'rejection',
                        'Ответ по вашему отклику — {{company_name}}',
                        '<p>Здравствуйте, {{candidate_name}}!</p><p>Благодарим вас за интерес к позиции <b>{{vacancy_title}}</b> в {{company_name}} и время, уделённое на прохождение отбора.</p><p>К сожалению, в этот раз мы приняли решение в пользу другого кандидата. Это не умаляет ваших профессиональных качеств — конкурс был очень высоким.</p><p>Мы сохраним ваше резюме и обязательно свяжемся, если появится подходящая вакансия.</p><p>Желаем успехов в поиске!<br>С уважением,<br>{{hr_name}}</p>',
                        'Здравствуйте, {{candidate_name}}! Благодарим за интерес к позиции {{vacancy_title}}. К сожалению, мы приняли решение в пользу другого кандидата. Желаем успехов! С уважением, {{hr_name}}',
                        true, true,
                        '[\"candidate_name\", \"vacancy_title\", \"company_name\", \"hr_name\"]'::json,
                        '[]'::json, now(), now())
                \"\"\"), {'oid': oid})

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

        # form_templates.is_template: HR-created reusable templates flag.
        # Идемпотентно — alembic-цепочка на проде сломана (multiple heads),
        # поэтому колонку гарантирует этот safety-net, иначе любой запрос к
        # form_templates падает 500 (модель ссылается на отсутствующую колонку).
        await conn.execute(text('ALTER TABLE form_templates ADD COLUMN IF NOT EXISTS is_template BOOLEAN NOT NULL DEFAULT false'))

        print('All columns verified')

    # ALTER TYPE ADD VALUE cannot run inside a transaction — use raw connection
    from sqlalchemy.pool import NullPool
    raw_engine = create_async_engine(db_url, poolclass=NullPool, isolation_level='AUTOCOMMIT')
    async with raw_engine.connect() as raw_conn:
        result = await raw_conn.execute(text(
            \"SELECT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'hr' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'orgrole'))\"
        ))
        if not result.scalar():
            print('Adding hr value to orgrole enum...')
            await raw_conn.execute(text(\"ALTER TYPE orgrole ADD VALUE 'hr'\"))
            print('Added hr to orgrole enum')

        # Add 'pending_review' to vacancystatus enum (заявка на апрув)
        result = await raw_conn.execute(text(
            \"SELECT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'pending_review' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'vacancystatus'))\"
        ))
        if not result.scalar():
            print('Adding pending_review value to vacancystatus enum...')
            await raw_conn.execute(text(\"ALTER TYPE vacancystatus ADD VALUE 'pending_review'\"))
            print('Added pending_review to vacancystatus enum')

        # Add 'reserve' to applicationstage enum (этап «Резерв»)
        result = await raw_conn.execute(text(
            \"SELECT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'reserve' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'applicationstage'))\"
        ))
        if not result.scalar():
            print('Adding reserve value to applicationstage enum...')
            await raw_conn.execute(text(\"ALTER TYPE applicationstage ADD VALUE 'reserve'\"))
            print('Added reserve to applicationstage enum')

        # Add 'reserve' to entitystatus enum
        result = await raw_conn.execute(text(
            \"SELECT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'reserve' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'entitystatus'))\"
        ))
        if not result.scalar():
            print('Adding reserve value to entitystatus enum...')
            await raw_conn.execute(text(\"ALTER TYPE entitystatus ADD VALUE 'reserve'\"))
            print('Added reserve to entitystatus enum')

        # Add 'withdrawn' to entitystatus enum (статус «Отозван» в «Все кандидаты»)
        result = await raw_conn.execute(text(
            \"SELECT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'withdrawn' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'entitystatus'))\"
        ))
        if not result.scalar():
            print('Adding withdrawn value to entitystatus enum...')
            await raw_conn.execute(text(\"ALTER TYPE entitystatus ADD VALUE 'withdrawn'\"))
            print('Added withdrawn to entitystatus enum')

        # Add 'probation' to applicationstage enum (этап «Практика»)
        result = await raw_conn.execute(text(
            \"SELECT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'probation' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'applicationstage'))\"
        ))
        if not result.scalar():
            print('Adding probation value to applicationstage enum...')
            await raw_conn.execute(text(\"ALTER TYPE applicationstage ADD VALUE 'probation'\"))
            print('Added probation to applicationstage enum')

        # Add 'transferred' to applicationstage enum (этап «Перешёл в отдел»)
        result = await raw_conn.execute(text(
            \"SELECT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'transferred' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'applicationstage'))\"
        ))
        if not result.scalar():
            print('Adding transferred value to applicationstage enum...')
            await raw_conn.execute(text(\"ALTER TYPE applicationstage ADD VALUE 'transferred'\"))
            print('Added transferred to applicationstage enum')

        # Add 'probation' to entitystatus enum
        result = await raw_conn.execute(text(
            \"SELECT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'probation' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'entitystatus'))\"
        ))
        if not result.scalar():
            print('Adding probation value to entitystatus enum...')
            await raw_conn.execute(text(\"ALTER TYPE entitystatus ADD VALUE 'probation'\"))
            print('Added probation to entitystatus enum')

        # Add 'transferred' to entitystatus enum
        result = await raw_conn.execute(text(
            \"SELECT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'transferred' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'entitystatus'))\"
        ))
        if not result.scalar():
            print('Adding transferred value to entitystatus enum...')
            await raw_conn.execute(text(\"ALTER TYPE entitystatus ADD VALUE 'transferred'\"))
            print('Added transferred to entitystatus enum')

        # Мягкое удаление вакансий: колонка deleted_at (идемпотентно)
        await raw_conn.execute(text(\"ALTER TABLE vacancies ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP\"))
        print('Ensured vacancies.deleted_at column')

        # Теневая база дедупликации: entities.is_archived (идемпотентно).
        # bulk/CSV/парсер-импорт ставит true; индекс — для фильтра активных списков.
        await raw_conn.execute(text(\"ALTER TABLE entities ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false\"))
        await raw_conn.execute(text(\"CREATE INDEX IF NOT EXISTS ix_entities_is_archived ON entities (is_archived)\"))
        print('Ensured entities.is_archived column + index')
    await raw_engine.dispose()

    # One-time data migration: legacy draft → pending_review
    # 'Черновик' статус был removed с UI, существующие записи переезжают в новый
    # 'На рассмотрении' статус. Идемпотентно: WHERE status='draft'.
    async with engine.begin() as mig_conn:
        res = await mig_conn.execute(text(\"UPDATE vacancies SET status='pending_review' WHERE status='draft'\"))
        print(f\"Migrated {res.rowcount} draft vacancies → pending_review\")

    # XSS cleanup: вырезаем <html-теги> из существующих данных, в которых
    # они могли попасть до серверной санитизации. Идемпотентно (regex no-op
    # если тегов уже нет).
    import re as _re
    async with engine.begin() as san_conn:
        # vacancy.title
        res = await san_conn.execute(text(
            r\"UPDATE vacancies SET title = trim(regexp_replace(title, '<[^>]*>', '', 'g')) \"
            r\"WHERE title ~ '<[^>]*>'\"
        ))
        print(f\"Stripped HTML from {res.rowcount} vacancy titles\")

        # entity_tags_catalog.name
        res = await san_conn.execute(text(
            r\"UPDATE entity_tags_catalog SET name = trim(regexp_replace(name, '<[^>]*>', '', 'g')) \"
            r\"WHERE name ~ '<[^>]*>'\"
        ))
        print(f\"Stripped HTML from {res.rowcount} entity tag names\")

        # entities.name (имена кандидатов и контактов с XSS-payload)
        res = await san_conn.execute(text(
            r\"UPDATE entities SET name = trim(regexp_replace(name, '<[^>]*>', '', 'g')) \"
            r\"WHERE name ~ '<[^>]*>'\"
        ))
        print(f\"Stripped HTML from {res.rowcount} entity names\")

        # entities.tags (JSON-массив строк)
        rows = await san_conn.execute(text(
            r\"SELECT id, tags FROM entities WHERE tags::text ~ '<[^>]*>'\"
        ))
        entity_cleaned = 0
        for row in rows:
            try:
                cleaned = [_re.sub(r'<[^>]*>', '', t).strip()[:80] for t in (row.tags or []) if isinstance(t, str)]
                cleaned = [t for t in cleaned if t]
                await san_conn.execute(
                    text(\"UPDATE entities SET tags = CAST(:tags AS JSON) WHERE id = :id\"),
                    {'tags': __import__('json').dumps(cleaned, ensure_ascii=False), 'id': row.id}
                )
                entity_cleaned += 1
            except Exception as e:
                print(f\"Failed to clean tags on entity {row.id}: {e}\")
        print(f\"Stripped HTML from tags on {entity_cleaned} entities\")

        # vacancies.tags (JSON-массив строк) — обновляем элементы по одному
        rows = await san_conn.execute(text(
            r\"SELECT id, tags FROM vacancies WHERE tags::text ~ '<[^>]*>'\"
        ))
        cleaned_count = 0
        for row in rows:
            try:
                cleaned = [_re.sub(r'<[^>]*>', '', t).strip()[:80] for t in (row.tags or []) if isinstance(t, str)]
                cleaned = [t for t in cleaned if t]
                await san_conn.execute(
                    text(\"UPDATE vacancies SET tags = CAST(:tags AS JSON) WHERE id = :id\"),
                    {'tags': __import__('json').dumps(cleaned, ensure_ascii=False), 'id': row.id}
                )
                cleaned_count += 1
            except Exception as e:
                print(f\"Failed to clean tags on vacancy {row.id}: {e}\")
        print(f\"Stripped HTML from tags on {cleaned_count} vacancies\")

    # Backfill: переписываем custom_stages у вакансий, где сохранён старый набор
    # лейблов ('Новая заявка', 'Отбор', 'Собеседование назначено', 'Вышел на работу',
    # 'Отказ' и т.п.). Приводим к канону KANBAN_STATUS_LABELS.
    CANONICAL_LABELS = {
        'applied': 'Новый',
        'screening': 'Выполняет ТЗ',
        'phone_screen': 'Интервью с HR',
        'interview': 'Интервью с заказчиком',
        'assessment': 'Принятие решения',
        'offer': 'Выставлен оффер',
        'hired': 'Оффер принят',
        'probation': 'Практика',
        'transferred': 'Перешёл в отдел',
        'rejected': 'Отказ',
        'withdrawn': 'Отозван',
    }
    OLD_LABELS = {'Новая заявка', 'Отбор', 'Собеседование назначено',
                  'Собеседование пройдено', 'Вышел на работу', 'Отказ'}
    async with engine.begin() as cs_conn:
        rows = await cs_conn.execute(text(
            \"SELECT id, custom_stages FROM vacancies WHERE custom_stages IS NOT NULL\"
        ))
        cs_fixed = 0
        for row in rows:
            try:
                cs = row.custom_stages or {}
                cols = cs.get('columns') if isinstance(cs, dict) else None
                if not isinstance(cols, list) or not cols:
                    continue
                has_old = any(isinstance(c, dict) and c.get('label') in OLD_LABELS for c in cols)
                if not has_old:
                    continue
                new_cols = []
                for c in cols:
                    if not isinstance(c, dict):
                        continue
                    enum_key = c.get('maps_to') or c.get('key')
                    new_label = CANONICAL_LABELS.get(enum_key, c.get('label', enum_key))
                    nc = dict(c)
                    nc['label'] = new_label
                    new_cols.append(nc)
                new_cs = dict(cs)
                new_cs['columns'] = new_cols
                await cs_conn.execute(
                    text(\"UPDATE vacancies SET custom_stages = CAST(:cs AS JSON) WHERE id = :id\"),
                    {'cs': __import__('json').dumps(new_cs, ensure_ascii=False), 'id': row.id}
                )
                cs_fixed += 1
            except Exception as e:
                print(f\"Failed to backfill custom_stages on vacancy {row.id}: {e}\")
        print(f\"Backfilled custom_stages labels on {cs_fixed} vacancies\")

    # Backfill: легаси английский комментарий первичной заявки → русский.
    # Старые stage_transitions писались с comment='Initial application'; код теперь
    # пишет 'Первичная заявка'. Идемпотентно (WHERE comment='Initial application').
    async with engine.begin() as ia_conn:
        res = await ia_conn.execute(text(
            \"UPDATE stage_transitions SET comment='Первичная заявка' WHERE comment='Initial application'\"
        ))
        print(f\"Backfilled {res.rowcount} stage_transitions: Initial application -> Первичная заявка\")

    # Backfill: авто-метки HR (system_hr_tags) — кандидат ↔ забравшие его в
    # воронку рекрутеры. Та же логика, что api/services/hr_tags.py: уникальные
    # created_by активных заявок (кроме rejected/withdrawn), [{hr_id, name}].
    # Идемпотентно (distinct-guard) — доска корректна сразу после деплоя.
    async with engine.begin() as hr_conn:
        res = await hr_conn.execute(text(\"\"\"
            UPDATE entities e
            SET extra_data = (
                CASE WHEN jsonb_typeof(e.extra_data::jsonb) = 'object'
                     THEN e.extra_data::jsonb
                     ELSE '{}'::jsonb END
                || jsonb_build_object('system_hr_tags', sub.tags)
            )::json
            FROM (
                SELECT t.entity_id,
                       jsonb_agg(jsonb_build_object('hr_id', t.hr_id, 'name', u.name,
                                                    'vacancy_id', t.vacancy_id, 'vacancy_title', t.vacancy_title)
                                 ORDER BY t.hr_id, t.vacancy_id) AS tags
                FROM (
                    SELECT DISTINCT a.entity_id,
                           COALESCE(a.created_by, vac.created_by) AS hr_id,
                           a.vacancy_id,
                           vac.title AS vacancy_title
                    FROM vacancy_applications a
                    JOIN vacancies vac ON vac.id = a.vacancy_id
                    WHERE COALESCE(a.created_by, vac.created_by) IS NOT NULL
                      AND a.stage NOT IN ('rejected', 'withdrawn')
                ) t
                JOIN users u ON u.id = t.hr_id
                GROUP BY t.entity_id
            ) sub
            WHERE e.id = sub.entity_id
              AND COALESCE(e.extra_data::jsonb -> 'system_hr_tags', 'null'::jsonb)
                  IS DISTINCT FROM sub.tags
        \"\"\"))
        print(f\"Backfilled system_hr_tags on {res.rowcount} candidates\")

        res = await hr_conn.execute(text(\"\"\"
            UPDATE entities e
            SET extra_data = (e.extra_data::jsonb - 'system_hr_tags')::json
            WHERE jsonb_exists(e.extra_data::jsonb, 'system_hr_tags')
              AND NOT EXISTS (
                  SELECT 1 FROM vacancy_applications va
                  JOIN vacancies vac ON vac.id = va.vacancy_id
                  WHERE va.entity_id = e.id
                    AND COALESCE(va.created_by, vac.created_by) IS NOT NULL
                    AND va.stage NOT IN ('rejected', 'withdrawn')
              )
        \"\"\"))
        print(f\"Cleared stale system_hr_tags on {res.rowcount} candidates\")

    await engine.dispose()

asyncio.run(ensure_shadow_columns())
" || echo "Column check completed or skipped"

# Start server
echo "Starting server..."
exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000} --loop uvloop --http httptools
