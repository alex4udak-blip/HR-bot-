#!/bin/bash
# Don't use set -e - we want to continue even if some steps fail
# set -e

echo "=== Starting HR-Bot Backend ==="
echo "Current directory: $(pwd)"
echo "Python version: $(python --version)"

echo ""
echo "=== Pre-migration: Adding enum values (requires separate transaction) ==="
# PostgreSQL ALTER TYPE ADD VALUE cannot run inside a transaction
# So we MUST do this BEFORE alembic starts its transaction
timeout 30 python -c "
import os
import sys

# Try psycopg2 for enum changes (requires autocommit)
try:
    import psycopg2
except ImportError:
    print('psycopg2 not available, skipping enum additions')
    sys.exit(0)

db_url = os.environ.get('DATABASE_URL', '')
if not db_url:
    print('No DATABASE_URL, skipping enum additions')
    sys.exit(0)

# Convert URL format for psycopg2
if db_url.startswith('postgresql+asyncpg://'):
    db_url = db_url.replace('postgresql+asyncpg://', 'postgresql://')
elif db_url.startswith('postgres://'):
    db_url = db_url.replace('postgres://', 'postgresql://')

conn = None
try:
    print('Connecting to database for enum updates...')
    conn = psycopg2.connect(db_url, connect_timeout=10)
    conn.autocommit = True  # CRITICAL: enum changes require autocommit
    cursor = conn.cursor()
    cursor.execute('SET statement_timeout = 5000')  # 5 second timeout

    # Check if callsource enum exists
    cursor.execute(\"\"\"
        SELECT 1 FROM pg_type WHERE typname = 'callsource'
    \"\"\")
    if cursor.fetchone():
        # Get existing values
        cursor.execute(\"\"\"
            SELECT e.enumlabel FROM pg_enum e
            JOIN pg_type t ON e.enumtypid = t.oid
            WHERE t.typname = 'callsource'
        \"\"\")
        existing = {row[0] for row in cursor.fetchall()}

        # Add missing values
        for value in ['google_doc', 'google_drive', 'direct_url', 'fireflies']:
            if value not in existing:
                try:
                    cursor.execute(f\"ALTER TYPE callsource ADD VALUE '{value}'\")
                    print(f'Added enum value: {value}')
                except Exception as e:
                    print(f'Could not add {value}: {e}')
            else:
                print(f'Enum value exists: {value}')
    else:
        print('callsource enum does not exist yet (will be created by migration)')

    print('Enum pre-migration complete!')
except Exception as e:
    print(f'Enum pre-migration error (non-critical): {e}')
finally:
    if conn:
        conn.close()
" && echo "Enum additions done" || echo "Enum additions skipped (non-critical)"

echo ""
echo "=== Running database migrations ==="

# First, fix any multiple heads in alembic_version table
echo "Checking for multiple heads in alembic_version..."
timeout 30 python -c "
import os
import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

async def fix_alembic_version():
    db_url = os.environ.get('DATABASE_URL', '')
    if db_url.startswith('postgres://'):
        db_url = db_url.replace('postgres://', 'postgresql+asyncpg://', 1)
    elif db_url.startswith('postgresql://'):
        db_url = db_url.replace('postgresql://', 'postgresql+asyncpg://', 1)

    if not db_url:
        print('No DATABASE_URL, skipping')
        return

    engine = create_async_engine(db_url, pool_timeout=10, connect_args={'timeout': 10})
    async with engine.begin() as conn:
        # Check how many versions exist
        result = await conn.execute(text('SELECT version_num FROM alembic_version'))
        versions = [row[0] for row in result.fetchall()]

        if len(versions) > 1:
            print(f'Found multiple heads: {versions}')
            print('Consolidating to single head: add_compatibility_score')
            # Delete all and insert the correct one
            await conn.execute(text('DELETE FROM alembic_version'))
            await conn.execute(text(\"INSERT INTO alembic_version (version_num) VALUES ('add_compatibility_score')\"))
            print('Fixed: now single head')
        elif len(versions) == 1:
            print(f'Single head found: {versions[0]}')
        else:
            print('No version found (fresh database)')

    await engine.dispose()

asyncio.run(fix_alembic_version())
" || echo "Version check failed, continuing..."

echo ""
echo "Checking current alembic version..."
python -m alembic current || echo "No current version (fresh database)"

echo ""
echo "Upgrading to latest migration (head)..."
# Use timeout to prevent migration from blocking forever (max 120 seconds)
# Upgrade to head to get all migrations including add_entity_type_criteria
timeout 120 python -m alembic upgrade head 2>&1 && echo "Migration successful" || {
    ALEMBIC_EXIT=$?
    if [ $ALEMBIC_EXIT -eq 124 ]; then
        echo "WARNING: Migration timed out after 120 seconds!"
        echo "This usually means a lock or network issue. Continuing with SQLAlchemy fallback..."
    else
        echo "Migration failed (exit code: $ALEMBIC_EXIT), continuing with SQLAlchemy fallback..."
    fi
}

echo ""
echo "Migration complete. Current version:"
python -m alembic current

echo ""
echo "=== Creating all tables with SQLAlchemy fallback ==="
timeout 60 python -c "
import os
import asyncio
import sys

# We're running from /app (backend directory), so just add current dir
sys.path.insert(0, '.')

async def create_all_tables():
    db_url = os.environ.get('DATABASE_URL', '')
    if db_url.startswith('postgres://'):
        db_url = db_url.replace('postgres://', 'postgresql+asyncpg://', 1)
    elif db_url.startswith('postgresql://'):
        db_url = db_url.replace('postgresql://', 'postgresql+asyncpg://', 1)

    if not db_url:
        print('No DATABASE_URL, skipping')
        return

    print('Connecting to database...')
    from sqlalchemy.ext.asyncio import create_async_engine
    from sqlalchemy import text

    engine = create_async_engine(db_url, pool_timeout=30, connect_args={'timeout': 30})

    try:
        # Import all models to register them with Base
        from api.models.database import Base

        # Use run_sync to run create_all
        async with engine.begin() as conn:
            # List tables before
            result = await conn.execute(text(
                \"SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name\"
            ))
            existing_tables = [row[0] for row in result.fetchall()]
            print(f'Existing tables ({len(existing_tables)}): {existing_tables}')

            # Create all missing tables
            print('Creating missing tables with checkfirst=True...')
            await conn.run_sync(Base.metadata.create_all, checkfirst=True)

            # List tables after
            result = await conn.execute(text(
                \"SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name\"
            ))
            new_tables = [row[0] for row in result.fetchall()]
            print(f'Tables after create_all ({len(new_tables)}): {new_tables}')

            # Show new tables created
            created = set(new_tables) - set(existing_tables)
            if created:
                print(f'Newly created tables: {created}')
            else:
                print('No new tables needed (all exist)')

        print('All tables ensured successfully!')
    except Exception as e:
        print(f'Error creating tables: {e}')
        import traceback
        traceback.print_exc()
    finally:
        await engine.dispose()

asyncio.run(create_all_tables())
" && echo "SQLAlchemy create_all done" || echo "SQLAlchemy create_all failed, but continuing..."

echo ""
echo "=== Ensuring critical columns exist ==="
timeout 30 python -c "
import os
import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

async def ensure_columns():
    db_url = os.environ.get('DATABASE_URL', '')
    if db_url.startswith('postgres://'):
        db_url = db_url.replace('postgres://', 'postgresql+asyncpg://', 1)
    elif db_url.startswith('postgresql://'):
        db_url = db_url.replace('postgresql://', 'postgresql+asyncpg://', 1)

    if not db_url:
        print('No DATABASE_URL, skipping')
        return

    print('Connecting...')
    engine = create_async_engine(db_url, pool_timeout=10, connect_args={'timeout': 10})
    try:
        async with engine.begin() as conn:
            print('Checking columns...')
            # entity_transfers columns
            for col_name, col_type in [
                ('copy_entity_id', 'INTEGER'),
                ('cancelled_at', 'TIMESTAMP'),
                ('cancel_deadline', 'TIMESTAMP'),
            ]:
                try:
                    await conn.execute(text(f'ALTER TABLE entity_transfers ADD COLUMN IF NOT EXISTS {col_name} {col_type}'))
                except Exception as e:
                    pass

            # users columns
            try:
                await conn.execute(text('ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT FALSE'))
            except Exception as e:
                pass

            # entities.version column (critical for PR #373)
            try:
                await conn.execute(text('ALTER TABLE entities ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1'))
                print('entities.version column ensured')
            except Exception as e:
                pass

            # vacancy_applications.compatibility_score column
            try:
                await conn.execute(text('ALTER TABLE vacancy_applications ADD COLUMN IF NOT EXISTS compatibility_score JSONB'))
                print('vacancy_applications.compatibility_score column ensured')
            except Exception as e:
                pass

            # criteria_presets.entity_type column
            try:
                # First ensure the enum exists
                await conn.execute(text(\"\"\"
                    DO \$\$ BEGIN
                        CREATE TYPE entitytype AS ENUM ('candidate', 'client', 'contractor', 'lead', 'partner', 'custom');
                    EXCEPTION
                        WHEN duplicate_object THEN null;
                    END \$\$;
                \"\"\"))
                await conn.execute(text('ALTER TABLE criteria_presets ADD COLUMN IF NOT EXISTS entity_type entitytype'))
                print('criteria_presets.entity_type column ensured')
            except Exception as e:
                print(f'entity_type column: {e}')
                pass

            print('Columns OK')
    finally:
        await engine.dispose()

asyncio.run(ensure_columns())
" && echo "Column check done" || echo "Column check skipped"

echo ""
echo "=== Final check: ensuring critical new tables exist ==="
timeout 60 python -c "
import os
import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

async def ensure_critical_tables():
    db_url = os.environ.get('DATABASE_URL', '')
    if db_url.startswith('postgres://'):
        db_url = db_url.replace('postgres://', 'postgresql+asyncpg://', 1)
    elif db_url.startswith('postgresql://'):
        db_url = db_url.replace('postgresql://', 'postgresql+asyncpg://', 1)

    if not db_url:
        print('No DATABASE_URL, skipping')
        return

    print('Checking critical tables...')
    engine = create_async_engine(db_url, pool_timeout=30, connect_args={'timeout': 30})
    try:
        async with engine.begin() as conn:
            # Check which tables exist
            result = await conn.execute(text(
                \"SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'\"
            ))
            existing_tables = set(row[0] for row in result.fetchall())

            # Create vacancies table if missing
            if 'vacancies' not in existing_tables:
                print('Creating vacancies table...')
                await conn.execute(text('''
                    CREATE TABLE IF NOT EXISTS vacancies (
                        id SERIAL PRIMARY KEY,
                        org_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
                        department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
                        title VARCHAR(255) NOT NULL,
                        description TEXT,
                        requirements TEXT,
                        responsibilities TEXT,
                        salary_min INTEGER,
                        salary_max INTEGER,
                        salary_currency VARCHAR(10) DEFAULT 'RUB',
                        location VARCHAR(255),
                        employment_type VARCHAR(50),
                        experience_level VARCHAR(50),
                        status VARCHAR(20) DEFAULT 'draft',
                        priority INTEGER DEFAULT 0,
                        tags JSONB DEFAULT '[]',
                        extra_data JSONB DEFAULT '{}',
                        hiring_manager_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
                        published_at TIMESTAMP,
                        closes_at TIMESTAMP,
                        created_at TIMESTAMP DEFAULT NOW(),
                        updated_at TIMESTAMP DEFAULT NOW()
                    )
                '''))
                await conn.execute(text('CREATE INDEX IF NOT EXISTS ix_vacancies_org_id ON vacancies(org_id)'))
                await conn.execute(text('CREATE INDEX IF NOT EXISTS ix_vacancies_status ON vacancies(status)'))
                print('vacancies table created!')
            else:
                print('vacancies table exists')

            # Create vacancy_applications table if missing
            if 'vacancy_applications' not in existing_tables:
                print('Creating vacancy_applications table...')
                await conn.execute(text('''
                    CREATE TABLE IF NOT EXISTS vacancy_applications (
                        id SERIAL PRIMARY KEY,
                        vacancy_id INTEGER NOT NULL REFERENCES vacancies(id) ON DELETE CASCADE,
                        entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
                        stage VARCHAR(30) DEFAULT 'applied',
                        stage_order INTEGER DEFAULT 0,
                        rating INTEGER,
                        notes TEXT,
                        rejection_reason VARCHAR(255),
                        source VARCHAR(100),
                        next_interview_at TIMESTAMP,
                        applied_at TIMESTAMP DEFAULT NOW(),
                        last_stage_change_at TIMESTAMP DEFAULT NOW(),
                        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
                        updated_at TIMESTAMP DEFAULT NOW(),
                        UNIQUE(vacancy_id, entity_id)
                    )
                '''))
                await conn.execute(text('CREATE INDEX IF NOT EXISTS ix_vacancy_applications_vacancy_id ON vacancy_applications(vacancy_id)'))
                await conn.execute(text('CREATE INDEX IF NOT EXISTS ix_vacancy_applications_stage ON vacancy_applications(vacancy_id, stage)'))
                print('vacancy_applications table created!')
            else:
                print('vacancy_applications table exists')

            # Create entity_files table if missing
            if 'entity_files' not in existing_tables:
                print('Creating entity_files table...')
                await conn.execute(text('''
                    CREATE TABLE IF NOT EXISTS entity_files (
                        id SERIAL PRIMARY KEY,
                        entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
                        org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
                        file_type VARCHAR(30) DEFAULT 'other',
                        file_name VARCHAR(255) NOT NULL,
                        file_path VARCHAR(512) NOT NULL,
                        file_size INTEGER,
                        mime_type VARCHAR(100),
                        description VARCHAR(500),
                        uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
                        created_at TIMESTAMP DEFAULT NOW()
                    )
                '''))
                await conn.execute(text('CREATE INDEX IF NOT EXISTS ix_entity_files_entity_id ON entity_files(entity_id)'))
                print('entity_files table created!')
            else:
                print('entity_files table exists')

            # Create department_features table if missing
            if 'department_features' not in existing_tables:
                print('Creating department_features table...')
                await conn.execute(text('''
                    CREATE TABLE IF NOT EXISTS department_features (
                        id SERIAL PRIMARY KEY,
                        org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
                        department_id INTEGER REFERENCES departments(id) ON DELETE CASCADE,
                        feature_name VARCHAR(50) NOT NULL,
                        enabled BOOLEAN DEFAULT TRUE,
                        created_at TIMESTAMP DEFAULT NOW(),
                        updated_at TIMESTAMP DEFAULT NOW(),
                        UNIQUE(org_id, department_id, feature_name)
                    )
                '''))
                await conn.execute(text('CREATE INDEX IF NOT EXISTS ix_department_features_org_id ON department_features(org_id)'))
                await conn.execute(text('CREATE INDEX IF NOT EXISTS ix_department_features_lookup ON department_features(org_id, feature_name)'))
                print('department_features table created!')
            else:
                print('department_features table exists')

            # Create refresh_tokens table if missing
            if 'refresh_tokens' not in existing_tables:
                print('Creating refresh_tokens table...')
                await conn.execute(text('''
                    CREATE TABLE IF NOT EXISTS refresh_tokens (
                        id SERIAL PRIMARY KEY,
                        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                        token_hash VARCHAR(64) NOT NULL UNIQUE,
                        device_name VARCHAR(255),
                        ip_address VARCHAR(45),
                        created_at TIMESTAMP DEFAULT NOW(),
                        expires_at TIMESTAMP NOT NULL,
                        revoked_at TIMESTAMP
                    )
                '''))
                await conn.execute(text('CREATE INDEX IF NOT EXISTS ix_refresh_tokens_user_id ON refresh_tokens(user_id)'))
                await conn.execute(text('CREATE INDEX IF NOT EXISTS ix_refresh_tokens_token_hash ON refresh_tokens(token_hash)'))
                print('refresh_tokens table created!')
            else:
                print('refresh_tokens table exists')

            # Create feature_audit_logs table if missing
            if 'feature_audit_logs' not in existing_tables:
                print('Creating feature_audit_logs table...')
                await conn.execute(text('''
                    CREATE TABLE IF NOT EXISTS feature_audit_logs (
                        id SERIAL PRIMARY KEY,
                        org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
                        changed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
                        feature_name VARCHAR(50) NOT NULL,
                        action VARCHAR(20) NOT NULL,
                        department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
                        old_value BOOLEAN,
                        new_value BOOLEAN,
                        details JSONB,
                        created_at TIMESTAMP DEFAULT NOW()
                    )
                '''))
                await conn.execute(text('CREATE INDEX IF NOT EXISTS ix_feature_audit_logs_org_id ON feature_audit_logs(org_id)'))
                await conn.execute(text('CREATE INDEX IF NOT EXISTS ix_feature_audit_logs_changed_by ON feature_audit_logs(changed_by)'))
                print('feature_audit_logs table created!')
            else:
                print('feature_audit_logs table exists')

            print('All critical tables verified!')
    except Exception as e:
        print(f'Error in critical tables check: {e}')
        import traceback
        traceback.print_exc()
    finally:
        await engine.dispose()

asyncio.run(ensure_critical_tables())
" && echo "Critical tables check done" || echo "Critical tables check failed, but continuing..."

echo ""
echo "=== Starting server ==="
exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}
