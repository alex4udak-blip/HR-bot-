#!/bin/bash
set -e

echo "=== Starting HR-Bot Backend ==="
echo "Current directory: $(pwd)"
echo "Python version: $(python --version)"

echo ""
echo "=== Running database migrations ==="

# First, fix any multiple heads in alembic_version table
echo "Checking for multiple heads in alembic_version..."
python -c "
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

    engine = create_async_engine(db_url)
    async with engine.begin() as conn:
        # Check how many versions exist
        result = await conn.execute(text('SELECT version_num FROM alembic_version'))
        versions = [row[0] for row in result.fetchall()]

        if len(versions) > 1:
            print(f'Found multiple heads: {versions}')
            print('Consolidating to single head: add_must_change_pwd')
            # Delete all and insert the correct one
            await conn.execute(text('DELETE FROM alembic_version'))
            await conn.execute(text(\"INSERT INTO alembic_version (version_num) VALUES ('add_must_change_pwd')\"))
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
echo "Upgrading to head..."
python -m alembic upgrade head 2>&1 && echo "Migration successful" || {
    echo "Upgrade failed, but continuing - columns will be ensured below"
}

echo ""
echo "Migration complete. Current version:"
python -m alembic current

echo ""
echo "=== Ensuring critical columns exist ==="
python -c "
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
        print('No DATABASE_URL, skipping column check')
        return

    engine = create_async_engine(db_url)
    async with engine.begin() as conn:
        # Add missing transfer cancel columns
        cols = [
            ('copy_entity_id', 'INTEGER REFERENCES entities(id) ON DELETE SET NULL'),
            ('cancelled_at', 'TIMESTAMP'),
            ('cancel_deadline', 'TIMESTAMP'),
        ]
        for col_name, col_type in cols:
            try:
                await conn.execute(text(f'ALTER TABLE entity_transfers ADD COLUMN IF NOT EXISTS {col_name} {col_type}'))
                print(f'Ensured column: entity_transfers.{col_name}')
            except Exception as e:
                print(f'Column {col_name}: {e}')

        # Add must_change_password column if missing
        try:
            await conn.execute(text('ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT FALSE'))
            print('Ensured column: users.must_change_password')
        except Exception as e:
            print(f'Column must_change_password: {e}')
    await engine.dispose()

asyncio.run(ensure_columns())
" || echo "Column check failed, continuing anyway..."

echo ""
echo "=== Starting server ==="
exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}
