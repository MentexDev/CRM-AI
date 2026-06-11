"""
Más capacidades del CRM para el Crew — vía la Edge Function `agent-tools`:

  • WebSearchTool      → búsqueda web real (Tavily)
  • GetInventoryTool   → stock por SKU en Shopify (lectura)
  • AdjustInventoryTool→ ajuste con UMBRAL: >20u crea aprobación y NO ejecuta

Mismos guardrails que el CRM: el ajuste de inventario sensible pasa por aprobación.
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
        f"{base}/functions/v1/agent-tools",
        json=payload,
        headers={
            "Authorization": f"Bearer {anon}",
            "apikey": anon,
            "X-Engine-Key": engine_key,
            "Content-Type": "application/json",
        },
        timeout=40,
    )
    resp.raise_for_status()
    return resp.json()


# ------------------------------------------------------------------ web_search
class WebSearchInput(BaseModel):
    query: str = Field(..., description="Qué buscar en la web (tendencias, competencia, datos).")


class WebSearchTool(BaseTool):
    name: str = "web_search"
    description: str = (
        "Busca en la web en tiempo real (Tavily). Úsalo para tendencias, competencia "
        "o datos actuales que el Brain no tiene. Devuelve un resumen + fuentes."
    )
    args_schema: Type[BaseModel] = WebSearchInput

    def _run(self, query: str) -> str:
        try:
            d = _post({"action": "web_search", "query": query, "limit": 4})
        except requests.RequestException as exc:
            return f"[web_search] Error de red: {exc}"
        if not d.get("ok"):
            return f"[web_search] {d.get('error', 'sin resultados')}"
        lines = []
        if d.get("answer"):
            lines.append(f"Resumen: {d['answer']}")
        for r in d.get("results", []):
            lines.append(f"• {r['title']} — {r['url']}")
        return "\n".join(lines) or "Sin resultados."


# --------------------------------------------------------------- get_inventory
class GetInventoryInput(BaseModel):
    sku: str = Field(..., description="SKU del producto a consultar.")


class GetInventoryTool(BaseTool):
    name: str = "get_inventory"
    description: str = "Consulta el stock disponible de un SKU en Shopify (por location)."
    args_schema: Type[BaseModel] = GetInventoryInput

    def _run(self, sku: str) -> str:
        try:
            d = _post({"action": "get_inventory", "sku": sku})
        except requests.RequestException as exc:
            return f"[get_inventory] Error de red: {exc}"
        if not d.get("ok"):
            return f"[get_inventory] {d.get('error', 'sin datos')}"
        levels = ", ".join(f"{l['location_name']}: {l['available']}u (loc {l['location_id']})" for l in d.get("levels", []))
        return f"SKU {sku} · total {d.get('total_available')}u — {levels}"


# ------------------------------------------------------------ adjust_inventory
class AdjustInventoryInput(BaseModel):
    sku: str = Field(..., description="SKU a ajustar.")
    location_id: str = Field(..., description="ID de location (sácalo de get_inventory).")
    delta: int = Field(..., description="Unidades a sumar (+) o restar (−).")
    reason: str = Field("correction", description="Razón del ajuste.")


class AdjustInventoryTool(BaseTool):
    name: str = "adjust_inventory"
    description: str = (
        "Ajusta el stock de un SKU en Shopify. GUARDRAIL: si |delta|>20 unidades NO se "
        "ejecuta — crea una aprobación para la Junta. ≤20 se aplica directo."
    )
    args_schema: Type[BaseModel] = AdjustInventoryInput
    agent_id: str = ""

    def _run(self, sku: str, location_id: str, delta: int, reason: str = "correction") -> str:
        try:
            d = _post({
                "action": "adjust_inventory", "agent_id": self.agent_id,
                "sku": sku, "location_id": location_id, "delta": delta, "reason": reason,
            })
        except requests.RequestException as exc:
            return f"[adjust_inventory] Error de red: {exc}"
        if d.get("requires_approval"):
            return f"⏳ {d.get('error')}"
        if not d.get("ok"):
            return f"[adjust_inventory] {d.get('error', 'falló')}"
        return f"✅ Inventario ajustado: SKU {sku} ahora {d.get('available')}u (Δ {d.get('delta_applied')})."
