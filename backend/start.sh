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
# Get current version to check if already at head
CURRENT_VERSION=$(python -m alembic current 2>/dev/null | grep -oE '^[a-z0-9_]+' | head -1)
echo "Current DB version: ${CURRENT_VERSION:-none}"

# Try upgrade, handle various error cases gracefully
python -m alembic upgrade head 2>&1 && echo "Migration successful" || {
    UPGRADE_ERROR=$?
    # If already at latest version, the overlap error is expected - continue
    if [ "$CURRENT_VERSION" = "add_must_change_pwd" ]; then
        echo "Already at latest migration (add_must_change_pwd), continuing..."
    else
        echo "Single head upgrade failed (exit code: $UPGRADE_ERROR)"
        echo "Trying 'heads' for multiple branches..."
        python -m alembic upgrade heads 2>&1 || {
            echo "WARNING: Migration commands failed, but continuing startup..."
            echo "The database might already be up to date or require manual intervention."
        }
    fi
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
