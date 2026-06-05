"""
QueryBrainTool — puente entre el motor agéntico (CrewAI) y el Brain del CRM.

No reimplementa nada del Brain: hace POST a la Edge Function `query-brain`
(retrieval híbrido vector + FTS + grafo) que ya está desplegada en Supabase.
Así, migrar al motor nuevo NO tira a la basura lo construido: el Brain pasa a
ser una herramienta que cualquier agente del Crew puede invocar.
"""

import os
from typing import Type

import requests
from pydantic import BaseModel, Field
from crewai.tools import BaseTool


class QueryBrainInput(BaseModel):
    query: str = Field(
        ...,
        description=(
            "Pregunta en lenguaje natural sobre la marca: voz de marca, "
            "políticas comerciales, productos, decisiones pasadas o aprendizajes."
        ),
    )


class QueryBrainTool(BaseTool):
    name: str = "query_brain"
    description: str = (
        "Consulta el Brain (memoria viva) de la marca: voz, políticas comerciales, "
        "productos, histórico de decisiones y aprendizajes. Úsalo SIEMPRE antes de "
        "afirmar algo sobre la marca o de producir contenido en su nombre."
    )
    args_schema: Type[BaseModel] = QueryBrainInput

    # Marca a la que apunta esta instancia de la herramienta (inyectada al crear el agente)
    brand_id: str = ""

    def _run(self, query: str) -> str:
        base = os.environ.get("SUPABASE_URL", "").rstrip("/")
        anon = os.environ.get("SUPABASE_ANON_KEY", "")
        if not base or not anon:
            return "[query_brain] Faltan SUPABASE_URL / SUPABASE_ANON_KEY en el entorno."
        if not self.brand_id:
            return "[query_brain] Esta herramienta no tiene brand_id asignado."

        url = f"{base}/functions/v1/query-brain"
        try:
            resp = requests.post(
                url,
                json={"brand_id": self.brand_id, "query": query, "limit": 4},
                headers={
                    "Authorization": f"Bearer {anon}",
                    "apikey": anon,
                    "Content-Type": "application/json",
                },
                timeout=30,
            )
        except requests.RequestException as exc:
            return f"[query_brain] Error de red consultando el Brain: {exc}"

        if resp.status_code != 200:
            return f"[query_brain] El Brain respondió {resp.status_code}: {resp.text[:300]}"

        data = resp.json()
        if not data.get("ok"):
            return f"[query_brain] {data.get('error', 'sin resultados')}"

        chunks = data.get("chunks", [])
        entities = data.get("entities", [])
        if not chunks and not entities:
            return "El Brain no encontró información relevante para esa consulta."

        # Recorte de tokens: máx 4 fragmentos y ~320 caracteres cada uno.
        # Mantiene la señal y evita reventar el límite TPM de Groq (tier free).
        lines = [f"📚 Brain · {len(chunks)} fragmentos · {len(entities)} entidades"]
        for i, c in enumerate(chunks[:4], 1):
            title = c.get("document_title") or c.get("source_kind") or "fragmento"
            content = (c.get("content") or "").strip()
            if len(content) > 320:
                content = content[:320].rstrip() + "…"
            lines.append(f"\n[{i}] ({title})\n{content}")
        if entities:
            names = ", ".join(f"{e.get('name')} [{e.get('kind')}]" for e in entities[:6])
            lines.append(f"\n— Entidades: {names}")
        return "\n".join(lines)
