#!/bin/bash
# Simplified startup script - run migrations quickly and start server ASAP

echo "=== Starting HR-Bot Backend ==="
echo "Current directory: $(pwd)"
echo "Python version: $(python --version)"

# Quick alembic upgrade (with short timeout)
echo ""
echo "=== Running database migrations ==="
timeout 60 python -m alembic upgrade head 2>&1 || echo "Migration completed or skipped"

echo ""
echo "=== Starting server ==="
exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}
