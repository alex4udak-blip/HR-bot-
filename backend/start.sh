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

        print('Shadow user columns verified')
    await engine.dispose()

asyncio.run(ensure_shadow_columns())
" || echo "Column check completed or skipped"

# Start server
echo "Starting server..."
exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}
