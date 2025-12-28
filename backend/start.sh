#!/bin/bash
set -e

echo "=== Starting HR-Bot Backend ==="
echo "Current directory: $(pwd)"
echo "Python version: $(python --version)"

echo ""
echo "=== Running database migrations ==="
echo "Checking current alembic version..."
python -m alembic current || echo "No current version (fresh database)"

echo ""
echo "Upgrading to head..."
python -m alembic upgrade head || {
    echo "Single head failed, trying 'heads' (multiple branches)..."
    python -m alembic upgrade heads
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
    await engine.dispose()

asyncio.run(ensure_columns())
" || echo "Column check failed, continuing anyway..."

echo ""
echo "=== Starting server ==="
exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}
