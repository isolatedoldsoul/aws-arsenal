# Stage 1: Build React frontend
FROM node:20-alpine AS frontend-build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Stage 2: Python backend + serve frontend as static files
FROM python:3.11-slim
WORKDIR /app

# System deps for ptyprocess (SSO terminal)
RUN apt-get update && apt-get install -y --no-install-recommends \
    awscli \
    && rm -rf /var/lib/apt/lists/*

# Python deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Backend source
COPY backend/ ./backend/
COPY scanners/ ./scanners/

# Frontend build output
COPY --from=frontend-build /app/dist ./frontend/dist

# Config (mounted at runtime via docker-compose volume — not baked in)
# config.json is expected at /app/config.json via volume mount

EXPOSE 8080

ENV PYTHONUNBUFFERED=1
CMD ["uvicorn", "backend.app:app", "--host", "0.0.0.0", "--port", "8080"]
