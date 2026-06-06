"""
API web del motor agéntico — expone el Crew para que la UI React lo consuma.

Patrón job (una corrida tarda minutos, así la UI no se cuelga):
  POST /runs        { directive }            → { run_id, status: "running" }
  GET  /runs/{id}                            → { status, result | error, side_effects }
  GET  /health                               → { ok, model }

Auth opcional por cabecera  X-Engine-Key  (== env ENGINE_API_KEY).
CORS abierto para que el frontend (localhost o dominio desplegado) lo llame.

Local:   uvicorn server:app --reload
Prod:    uvicorn server:app --host 0.0.0.0 --port $PORT
"""

import os
import threading
import uuid

from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from crm_crew.crew import build_crew

load_dotenv()

ENGINE_API_KEY = os.environ.get("ENGINE_API_KEY")  # si está, se exige en las cabeceras

app = FastAPI(title="CRM · Agent Engine", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # en prod, restringir al dominio de la UI
    allow_methods=["*"],
    allow_headers=["*"],
)

# Store en memoria (POC). En producción: tabla en Supabase o Redis para persistir
# entre reinicios y escalar a varias instancias.
RUNS: dict[str, dict] = {}


class RunRequest(BaseModel):
    directive: str


def _auth(key: str | None) -> None:
    if ENGINE_API_KEY and key != ENGINE_API_KEY:
        raise HTTPException(status_code=401, detail="X-Engine-Key inválida o ausente")


def _run_crew(run_id: str, directive: str) -> None:
    try:
        crew = build_crew(directive)
        result = crew.kickoff()
        RUNS[run_id].update(status="done", result=str(result))
    except Exception as exc:  # noqa: BLE001 — queremos reportar cualquier fallo al cliente
        RUNS[run_id].update(status="error", error=str(exc))


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
    threading.Thread(target=_run_crew, args=(run_id, directive), daemon=True).start()
    return {"run_id": run_id, "status": "running"}


@app.get("/runs/{run_id}")
def get_run(run_id: str, x_engine_key: str | None = Header(default=None)) -> dict:
    _auth(x_engine_key)
    run = RUNS.get(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="run_id no encontrado")
    return {"run_id": run_id, **run}


# Arranque directo (Railway/host): el PORT lo lee Python, no el shell.
# Así evitamos problemas de expansión de variables en el startCommand.
if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run(app, host="0.0.0.0", port=port)
