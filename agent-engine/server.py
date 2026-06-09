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

import os
import threading
import uuid
from datetime import datetime, timezone

import requests
from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from crm_crew.crew import build_crew

load_dotenv()

ENGINE_API_KEY = os.environ.get("ENGINE_API_KEY")  # si está, se exige en las cabeceras
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")
RUN_TIMEOUT_S = 15 * 60  # una corrida "running" más vieja que esto se asume caída

app = FastAPI(title="CRM · Agent Engine", version="0.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # en prod, restringir al dominio de la UI
    allow_methods=["*"],
    allow_headers=["*"],
)

# Caché en memoria (rápido para el polling). La fuente durable es Supabase.
RUNS: dict[str, dict] = {}


class RunRequest(BaseModel):
    directive: str


def _auth(key: str | None) -> None:
    if ENGINE_API_KEY and key != ENGINE_API_KEY:
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
                "Content-Type": "application/json",
            },
            timeout=15,
        )
        return r.json()
    except Exception as exc:  # noqa: BLE001 — persistencia best-effort
        print(f"[persist:{action}] {exc}")
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
    try:
        crew = build_crew(directive)
        result = crew.kickoff()
        RUNS[run_id].update(status="done", result=str(result))
        _persist("finish", {"run_id": run_id, "status": "done", "result": str(result)})
    except Exception as exc:  # noqa: BLE001 — queremos reportar cualquier fallo al cliente
        RUNS[run_id].update(status="error", error=str(exc))
        _persist("finish", {"run_id": run_id, "status": "error", "error": str(exc)})


@app.get("/health")
def health() -> dict:
    return {"ok": True, "model": os.environ.get("MODEL", "?"), "active_runs": len(RUNS)}


@app.post("/runs")
def start_run(req: RunRequest, x_engine_key: str | None = Header(default=None)) -> dict:
    _auth(x_engine_key)
    directive = req.directive.strip()
    if not directive:
        raise HTTPException(status_code=400, detail="Falta 'directive'")
    run_id = uuid.uuid4().hex[:12]
    RUNS[run_id] = {"status": "running", "directive": directive}
    _persist("create", {"run_id": run_id, "directive": directive})
    threading.Thread(target=_run_crew, args=(run_id, directive), daemon=True).start()
    return {"run_id": run_id, "status": "running"}


@app.get("/runs/{run_id}")
def get_run(run_id: str, x_engine_key: str | None = Header(default=None)) -> dict:
    _auth(x_engine_key)

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
