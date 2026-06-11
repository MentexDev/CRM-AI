"""
Acciones REALES sobre el flujo del proyecto — el salto de "consultar" a "ejecutar".

Cada herramienta llama a la Edge Function `agent-action`, que escribe en las MISMAS
tablas que lee la UI del CRM. Así un agente del Crew puede:

  • CreateTaskTool       → crear una tarea (aparece en la página Tareas)
  • RequestApprovalTool  → pedir aprobación a la Junta (página Aprobaciones, human-in-the-loop)

Respeta los guardrails del CRM: las acciones sensibles pasan por aprobación humana.
"""

import os
from typing import Type

import requests
from pydantic import BaseModel, Field
from crewai.tools import BaseTool


def _post(payload: dict) -> dict:
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    anon = os.environ.get("SUPABASE_ANON_KEY", "")
    engine_key = os.environ.get("ENGINE_API_KEY", "")
    if not base or not anon:
        raise RuntimeError("Faltan SUPABASE_URL / SUPABASE_ANON_KEY")
    if not engine_key:
        raise RuntimeError("Falta ENGINE_API_KEY (clave interna motor↔Edge Functions)")
    resp = requests.post(
        f"{base}/functions/v1/agent-action",
        json=payload,
        headers={
            "Authorization": f"Bearer {anon}",
            "apikey": anon,
            "X-Engine-Key": engine_key,
            "Content-Type": "application/json",
        },
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


# ----------------------------------------------------------------- create_task
class CreateTaskInput(BaseModel):
    title: str = Field(..., description="Título corto y accionable de la tarea.")
    description: str = Field("", description="Detalle: objetivo y contexto de la tarea.")
    priority: int = Field(3, description="Prioridad 1 (alta) a 5 (baja).")


class CreateTaskTool(BaseTool):
    name: str = "create_task"
    description: str = (
        "Crea una tarea REAL en el flujo del proyecto (aparece en la página Tareas del "
        "CRM). Úsalo para registrar trabajo concreto que debe ejecutarse."
    )
    args_schema: Type[BaseModel] = CreateTaskInput
    agent_id: str = ""

    def _run(self, title: str, description: str = "", priority: int = 3) -> str:
        try:
            data = _post({
                "action": "create_task",
                "agent_id": self.agent_id,
                "title": title,
                "description": description,
                "priority": priority,
            })
        except requests.RequestException as exc:
            return f"[create_task] Error de red: {exc}"
        if not data.get("ok"):
            return f"[create_task] {data.get('error', 'no se pudo crear')}"
        return f"✅ Tarea creada en el CRM (id {data['task_id'][:8]}…, estado to_do)."


# ------------------------------------------------------------ request_approval
class ApprovalInput(BaseModel):
    summary: str = Field(..., description="Qué se pide aprobar y por qué (claro y conciso).")
    trigger: str = Field(
        "agent_uncertain",
        description=(
            "Motivo (uno de): expense (gasto/presupuesto) | public_publish (publicar) | "
            "external_comm (comunicación externa) | structural | inventory_threshold | "
            "agent_uncertain (duda del agente)."
        ),
    )


class RequestApprovalTool(BaseTool):
    name: str = "request_approval"
    description: str = (
        "Pide una aprobación REAL a la Junta (aparece en la página Aprobaciones del CRM). "
        "Úsalo ANTES de cualquier acción sensible: presupuesto, descuentos, publicar, etc. "
        "Queda pendiente hasta que un humano decida."
    )
    args_schema: Type[BaseModel] = ApprovalInput
    agent_id: str = ""

    def _run(self, summary: str, trigger: str = "agent_request") -> str:
        try:
            data = _post({
                "action": "request_approval",
                "agent_id": self.agent_id,
                "summary": summary,
                "trigger": trigger,
            })
        except requests.RequestException as exc:
            return f"[request_approval] Error de red: {exc}"
        if not data.get("ok"):
            return f"[request_approval] {data.get('error', 'no se pudo crear')}"
        return f"⏳ Aprobación enviada a la Junta (id {data['approval_id'][:8]}…, pendiente)."
