#!/bin/bash
# Simplified startup script - run migrations quickly and start server ASAP

echo "=== Starting HR-Bot Backend ==="
echo "Current directory: $(pwd)"
echo "Python version: $(python --version)"

# Quick alembic upgrade (with short timeout)
echo ""
echo "=== Running database migrations ==="

# First try normal upgrade
if ! timeout 60 python -m alembic upgrade head 2>&1; then
    echo "Migration failed, trying to stamp head..."
    timeout 30 python -m alembic stamp head 2>&1 || echo "Stamp also failed"
fi

# Ensure embedding columns exist (fix for stamped but not run migrations)
echo ""
echo "=== Ensuring required columns exist ==="
python << 'PYEOF'
import os
import psycopg2

DATABASE_URL = os.environ.get("DATABASE_URL", "")
if DATABASE_URL:
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = True
    cur = conn.cursor()

    # Add embedding_updated_at to entities
    cur.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_name='entities' AND column_name='embedding_updated_at') THEN
                ALTER TABLE entities ADD COLUMN embedding_updated_at TIMESTAMP;
                RAISE NOTICE 'Added embedding_updated_at to entities';
            END IF;
        END $$;
    """)

    # Add embedding_updated_at to vacancies
    cur.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_name='vacancies' AND column_name='embedding_updated_at') THEN
                ALTER TABLE vacancies ADD COLUMN embedding_updated_at TIMESTAMP;
                RAISE NOTICE 'Added embedding_updated_at to vacancies';
            END IF;
        END $$;
    """)

    cur.close()
    conn.close()
    print("Column check completed")
else:
    print("No DATABASE_URL, skipping column check")
PYEOF

echo "Migration step completed"

echo ""
echo "=== Starting server ==="
exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}
