#!/bin/bash
set -e

echo "=== Starting HR-Bot Backend ==="

# Run migrations
echo "Running database migrations..."
python -m alembic upgrade head || echo "Migrations completed or skipped"

# Start server
echo "Starting server..."
exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}
