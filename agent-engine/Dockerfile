# Motor agéntico (CrewAI + FastAPI). Sirve para Fly, Railway o cualquier VPS.
# Imagen base con patch fijo (reproducibilidad / supply chain). Para máxima
# garantía, fija también el digest: python:3.12.8-slim-bookworm@sha256:<digest>.
FROM python:3.12.8-slim-bookworm

WORKDIR /app

# Dependencias del sistema mínimas (algunos wheels las requieren)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
  && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Usuario sin privilegios (no-root): reduce el blast radius si el motor,
# que ejecuta salidas de un LLM, fuera comprometido.
RUN addgroup --system app && adduser --system --ingroup app app
COPY --chown=app:app . .
USER app

ENV PORT=8000
EXPOSE 8000

# Healthcheck: marca el contenedor "unhealthy" si /health no responde.
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD python -c "import os,urllib.request; urllib.request.urlopen(f'http://localhost:{os.environ.get(\"PORT\",\"8000\")}/health')" || exit 1

# Python lee PORT (default 8000). Evita problemas de expansión en el shell.
CMD ["python", "server.py"]
