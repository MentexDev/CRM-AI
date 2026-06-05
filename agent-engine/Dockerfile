# Motor agéntico (CrewAI + FastAPI). Sirve para Fly, Railway o cualquier VPS.
FROM python:3.12-slim

WORKDIR /app

# Dependencias del sistema mínimas (algunos wheels las requieren)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
  && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV PORT=8000
EXPOSE 8000

# $PORT lo inyecta el host (Railway/Fly). Default 8000 en local/VPS.
CMD ["sh", "-c", "uvicorn server:app --host 0.0.0.0 --port ${PORT:-8000}"]
