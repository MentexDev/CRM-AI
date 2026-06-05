"""
Memoria persistente por agente — la pieza de "estado" tipo Letta, pero sobre
Supabase (sin Docker, sin server nuevo, sin vendor nuevo).

Dos herramientas que cada agente del Crew puede usar, ambas apuntando a la Edge
Function `agent-memory` (acciones recall/remember) ya desplegada:

  • RecallMemoryTool  → recuerda lo que ESTE agente aprendió en sesiones pasadas
  • SaveMemoryTool    → guarda un aprendizaje/decisión para el futuro

A diferencia del Brain (memoria compartida de la MARCA), esto es la memoria
PROPIA de cada agente, persistente entre corridas.
"""

import os
from typing import Type

import requests
from pydantic import BaseModel, Field
from crewai.tools import BaseTool


def _post(action: str, payload: dict) -> dict:
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    anon = os.environ.get("SUPABASE_ANON_KEY", "")
    if not base or not anon:
        raise RuntimeError("Faltan SUPABASE_URL / SUPABASE_ANON_KEY")
    resp = requests.post(
        f"{base}/functions/v1/agent-memory",
        json={"action": action, **payload},
        headers={
            "Authorization": f"Bearer {anon}",
            "apikey": anon,
            "Content-Type": "application/json",
        },
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


# --------------------------------------------------------------------- recall
class RecallInput(BaseModel):
    query: str = Field(..., description="Qué quieres recordar de tus sesiones pasadas.")


class RecallMemoryTool(BaseTool):
    name: str = "recall_memory"
    description: str = (
        "Recupera TU memoria de agente: decisiones, aprendizajes y notas de "
        "sesiones anteriores. Úsalo al inicio para no repetir trabajo ni errores."
    )
    args_schema: Type[BaseModel] = RecallInput
    agent_id: str = ""

    def _run(self, query: str) -> str:
        try:
            data = _post("recall", {"agent_id": self.agent_id, "query": query, "limit": 4})
        except requests.RequestException as exc:
            return f"[recall_memory] Error de red: {exc}"
        matches = data.get("matches", [])
        if not matches:
            return "No tengo recuerdos previos relevantes sobre eso."
        lines = ["🧠 Tu memoria (sesiones pasadas):"]
        for m in matches:
            lines.append(f"• [{m.get('kind')}] {m.get('content')}")
        return "\n".join(lines)


# ------------------------------------------------------------------- remember
class SaveInput(BaseModel):
    content: str = Field(..., description="El aprendizaje o decisión a recordar para el futuro.")
    kind: str = Field("learning", description="Tipo: note | decision | learning | reminder")


class SaveMemoryTool(BaseTool):
    name: str = "save_memory"
    description: str = (
        "Guarda en TU memoria de agente un aprendizaje o decisión importante, para "
        "recordarlo en futuras sesiones. Úsalo al cerrar una tarea relevante."
    )
    args_schema: Type[BaseModel] = SaveInput
    agent_id: str = ""
    brand_id: str = ""

    def _run(self, content: str, kind: str = "learning") -> str:
        try:
            data = _post(
                "remember",
                {
                    "agent_id": self.agent_id,
                    "kind": kind,
                    "content": content,
                    "brand_id": self.brand_id or None,
                },
            )
        except requests.RequestException as exc:
            return f"[save_memory] Error de red: {exc}"
        if not data.get("ok"):
            return f"[save_memory] {data.get('error', 'no se pudo guardar')}"
        return "✅ Guardado en mi memoria persistente."
