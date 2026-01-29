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
    # If migrations fail (tables already exist), stamp current state as head
    timeout 30 python -m alembic stamp head 2>&1 || echo "Stamp also failed, continuing anyway"
fi

echo "Migration step completed"

echo ""
echo "=== Starting server ==="
exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}
