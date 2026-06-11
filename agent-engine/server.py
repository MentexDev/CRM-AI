"""
API web del motor agéntico — expone el Crew para que la UI React lo consuma.

Patrón job (una corrida tarda minutos, así la UI no se cuelga):
  POST /runs        { directive }            → { run_id, status: "running" }
  GET  /runs/{id}                            → { status, result | error }
  GET  /health                               → { ok, model }

Persistencia HÍBRIDA: las corridas viven en memoria (rápido para el polling) y
se persisten en Supabase (tabla agent_runs vía Edge Function agent-run). Si el
motor reinicia, GET cae a la BD — la corrida y su historial sobreviven.

Auth opcional por cabecera  X-Engine-Key  (== env ENGINE_API_KEY).

Local:   uvicorn server:app --reload
Prod:    python server.py   (lee PORT del entorno)
"""

import hmac
import logging
import os
import threading
import time
import uuid
from collections import deque
from datetime import datetime, timezone

import requests
from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from crm_crew.crew import build_crew

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("agent-engine")

ENGINE_API_KEY = os.environ.get("ENGINE_API_KEY")  # secreto compartido; fail-closed si falta
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")
RUN_TIMEOUT_S = 15 * 60  # una corrida "running" más vieja que esto se asume caída

# Límites anti-abuso (DoS económico: cada corrida gasta tokens LLM de pago).
MAX_CONCURRENT_RUNS = int(os.environ.get("MAX_CONCURRENT_RUNS", "3"))
MAX_RUNS_PER_MINUTE = int(os.environ.get("MAX_RUNS_PER_MINUTE", "10"))
MAX_RUNS_CACHE = 200  # cota de la caché en memoria (evita crecimiento sin fin)

# CORS: la UI llama vía el proxy server-side run-engine, así que por defecto NO se
# permite ningún origen de navegador. Si alguna vez llamas el motor directo desde
# el browser, define ALLOWED_ORIGINS="https://tu-ui" (separados por coma).
ALLOWED_ORIGINS = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "").split(",") if o.strip()]

app = FastAPI(title="CRM · Agent Engine", version="0.3.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "X-Engine-Key"],
)

# Caché en memoria (rápido para el polling). La fuente durable es Supabase.
RUNS: dict[str, dict] = {}
_recent_starts: "deque[float]" = deque()  # timestamps de arranques (rate limit)
_runs_lock = threading.Lock()


class RunRequest(BaseModel):
    directive: str


def _auth(key: str | None, request: Request | None = None) -> None:
    # Fail-closed: sin ENGINE_API_KEY configurada NO se sirve (antes era fail-open).
    if not ENGINE_API_KEY:
        log.error("ENGINE_API_KEY no configurada — rechazando (fail-closed)")
        raise HTTPException(status_code=503, detail="Motor mal configurado: falta ENGINE_API_KEY")
    if not key or not hmac.compare_digest(key, ENGINE_API_KEY):
        ip = request.client.host if request and request.client else "?"
        path = request.url.path if request else "?"
        log.warning("auth_failed ip=%s path=%s", ip, path)
        raise HTTPException(status_code=401, detail="X-Engine-Key inválida o ausente")


def _persist(action: str, payload: dict) -> dict | None:
    """Llama a la Edge Function agent-run (best-effort; si falla, seguimos en memoria)."""
    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        return None
    try:
        r = requests.post(
            f"{SUPABASE_URL}/functions/v1/agent-run",
            json={"action": action, **payload},
            headers={
                "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
                "apikey": SUPABASE_ANON_KEY,
                "X-Engine-Key": ENGINE_API_KEY or "",
                "Content-Type": "application/json",
            },
            timeout=15,
        )
        return r.json()
    except Exception as exc:  # noqa: BLE001 — persistencia best-effort
        log.warning("persist_failed action=%s err=%s", action, exc)
        return None


def _is_stale(created_at: str | None) -> bool:
    if not created_at:
        return False
    try:
        ts = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
        return (datetime.now(timezone.utc) - ts).total_seconds() > RUN_TIMEOUT_S
    except Exception:
        return False


def _run_crew(run_id: str, directive: str) -> None:
    log.info("run_started run_id=%s", run_id)
    try:
        crew = build_crew(directive)
        result = crew.kickoff()
        RUNS[run_id].update(status="done", result=str(result))
        _persist("finish", {"run_id": run_id, "status": "done", "result": str(result)})
        log.info("run_finished run_id=%s status=done", run_id)
    except Exception as exc:  # noqa: BLE001 — queremos reportar cualquier fallo al cliente
        RUNS[run_id].update(status="error", error=str(exc))
        _persist("finish", {"run_id": run_id, "status": "error", "error": str(exc)})
        log.warning("run_finished run_id=%s status=error err=%s", run_id, exc)


@app.get("/health")
def health() -> dict:
    return {"ok": True, "model": os.environ.get("MODEL", "?"), "active_runs": len(RUNS)}


@app.post("/runs")
def start_run(req: RunRequest, request: Request, x_engine_key: str | None = Header(default=None)) -> dict:
    _auth(x_engine_key, request)
    directive = req.directive.strip()
    if not directive:
        raise HTTPException(status_code=400, detail="Falta 'directive'")

    with _runs_lock:
        # Rate limit por ventana de 60s.
        now = time.monotonic()
        while _recent_starts and now - _recent_starts[0] > 60:
            _recent_starts.popleft()
        if len(_recent_starts) >= MAX_RUNS_PER_MINUTE:
            raise HTTPException(status_code=429, detail="Demasiadas corridas; intenta en un minuto")
        # Concurrencia máxima de corridas activas.
        active = sum(1 for r in RUNS.values() if r.get("status") == "running")
        if active >= MAX_CONCURRENT_RUNS:
            raise HTTPException(status_code=429, detail=f"Máximo {MAX_CONCURRENT_RUNS} corridas simultáneas")
        _recent_starts.append(now)
        # Evicción de la caché: descarta las terminadas más antiguas si crece demasiado.
        if len(RUNS) >= MAX_RUNS_CACHE:
            finished = [k for k, v in RUNS.items() if v.get("status") != "running"]
            for k in finished[: len(RUNS) - MAX_RUNS_CACHE + 1]:
                RUNS.pop(k, None)
        run_id = uuid.uuid4().hex[:12]
        RUNS[run_id] = {"status": "running", "directive": directive}

    _persist("create", {"run_id": run_id, "directive": directive})
    threading.Thread(target=_run_crew, args=(run_id, directive), daemon=True).start()
    return {"run_id": run_id, "status": "running"}


@app.get("/runs/{run_id}")
def get_run(run_id: str, request: Request, x_engine_key: str | None = Header(default=None)) -> dict:
    _auth(x_engine_key, request)

    # 1) Caché en memoria (corrida en curso en esta instancia)
    run = RUNS.get(run_id)
    if run:
        return {"run_id": run_id, **run}

    # 2) Fallback a Supabase (sobrevive reinicios del motor)
    data = _persist("get", {"run_id": run_id})
    if data and data.get("found"):
        row = data["run"]
        status = row.get("status")
        if status == "running" and _is_stale(row.get("created_at")):
            return {
                "run_id": run_id,
                "status": "error",
                "error": "La corrida se interrumpió (el motor reinició). Vuelve a ejecutarla.",
                "directive": row.get("directive"),
            }
        return {
            "run_id": run_id,
            "status": status,
            "result": row.get("result"),
            "error": row.get("error"),
            "directive": row.get("directive"),
        }

    raise HTTPException(status_code=404, detail="run_id no encontrado")


# Arranque directo (Railway/host): el PORT lo lee Python, no el shell.
if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run(app, host="0.0.0.0", port=port)
