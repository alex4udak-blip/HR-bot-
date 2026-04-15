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

        # Check and add auto_tasks_enabled column to chats
        result = await conn.execute(text(
            \"SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'chats' AND column_name = 'auto_tasks_enabled')\"
        ))
        if not result.scalar():
            print('Adding auto_tasks_enabled column to chats...')
            await conn.execute(text('ALTER TABLE chats ADD COLUMN auto_tasks_enabled BOOLEAN DEFAULT true'))
        else:
            # Reset all chats to disabled, admin enables manually via /autotasks
            await conn.execute(text('UPDATE chats SET auto_tasks_enabled = false WHERE auto_tasks_enabled = true'))
            await conn.execute(text('ALTER TABLE chats ALTER COLUMN auto_tasks_enabled SET DEFAULT false'))

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
    await raw_engine.dispose()

    await engine.dispose()

asyncio.run(ensure_shadow_columns())
" || echo "Column check completed or skipped"

# Start server
echo "Starting server..."
exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000} --loop uvloop --http httptools
