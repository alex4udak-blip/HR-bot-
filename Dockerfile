# Stage 1: Build frontend
FROM node:20-alpine AS frontend-builder

WORKDIR /frontend

# Copy frontend files
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install

COPY frontend/ ./
RUN npm run build

# Stage 2: Build backend
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    ffmpeg \
    libreoffice-common \
    libreoffice-writer \
    libreoffice-calc \
    libreoffice-impress \
    unrar-free \
    libheif-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy backend files
COPY backend/ .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy built frontend from stage 1
COPY --from=frontend-builder /frontend/dist ./static

# Railway injects PORT environment variable
ENV PORT=8000
EXPOSE 8000

# Use sh -c to ensure PORT variable expansion works
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port $PORT"]
