# Stage 1: Build frontend
FROM node:20-alpine AS frontend-builder

WORKDIR /frontend

COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install

COPY frontend/ ./
RUN npm run build

# Stage 2: Build recorder dependencies
FROM node:20-slim AS recorder-builder

WORKDIR /recorder

COPY backend/recorder/package.json ./
RUN npm install --production

# Stage 3: Final image with Python + Node + Chromium
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies including Node.js and Chromium for Puppeteer
RUN apt-get update && apt-get install -y \
    ffmpeg \
    libreoffice-common \
    libreoffice-writer \
    libreoffice-calc \
    libreoffice-impress \
    unrar-free \
    libheif-dev \
    curl \
    gnupg \
    # Chromium dependencies
    chromium \
    chromium-sandbox \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Set Puppeteer to use system Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Copy backend files
COPY backend/ .

# Copy recorder node_modules from builder stage
COPY --from=recorder-builder /recorder/node_modules ./recorder/node_modules

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy built frontend from stage 1
COPY --from=frontend-builder /frontend/dist ./static

# Create uploads directory
RUN mkdir -p /app/uploads/calls

# Copy start script
COPY start.sh ./
RUN chmod +x start.sh

# Railway injects PORT environment variable
ENV PORT=8000
EXPOSE 8000

# Start both API and worker
CMD ["./start.sh"]
