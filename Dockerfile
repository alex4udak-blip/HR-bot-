# Stage 1: Build frontend
FROM node:20-alpine AS frontend-builder

WORKDIR /frontend

COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install

COPY frontend/ ./
RUN npm run build

# Stage 2: Final image - Python only (no Chromium for now)
FROM python:3.11-slim

WORKDIR /app

# Install minimal dependencies (no LibreOffice, no Chromium)
RUN apt-get update && apt-get install -y \
    ffmpeg \
    libheif-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy backend files
COPY backend/ .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy built frontend
COPY --from=frontend-builder /frontend/dist ./static

# Create uploads directory
RUN mkdir -p /app/uploads/calls

# Railway PORT
ENV PORT=8000
EXPOSE 8000

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port $PORT"]
