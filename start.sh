#!/bin/bash

# HR Bot Startup Script
# Runs both the API server and the call recording worker

set -e

echo "Starting HR Bot..."

# Start call worker in background (only if Redis is configured)
if [ -n "$REDIS_URL" ]; then
    echo "Starting call recording worker..."
    python -m api.workers.call_worker &
    WORKER_PID=$!
    echo "Worker started with PID: $WORKER_PID"
else
    echo "REDIS_URL not set, skipping call worker"
fi

# Start main API server
echo "Starting API server on port ${PORT:-8000}..."
exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}
