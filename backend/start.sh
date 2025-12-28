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
echo "=== Starting server ==="
exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}
