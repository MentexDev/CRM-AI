"""
Smoke-test: construye el Crew contra la librería real de CrewAI sin llamar al LLM
ni al Brain. Valida que roles, tareas, tools y delegación queden bien cableados.

    python smoke_test.py
"""

import os

# Valores ficticios: el build no hace llamadas de red, solo construye objetos.
os.environ.setdefault("MODEL", "groq/llama-3.3-70b-versatile")
os.environ.setdefault("GROQ_API_KEY", "test-key")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon")
os.environ.setdefault("NINA_BRAND_ID", "ac009239-c8ca-4b45-99ad-6a804419836c")

from crm_crew.crew import build_crew

crew = build_crew("Directiva de prueba para NINA")

print("✅ Crew construido correctamente\n")
print(f"Agentes: {len(crew.agents)}  ·  Tareas: {len(crew.tasks)}  ·  Proceso: {crew.process}\n")
for a in crew.agents:
    tools = ", ".join(t.name for t in a.tools) or "—"
    print(f"  • {a.role}")
    print(f"      delegación: {a.allow_delegation}  |  tools: {tools}")
print("\nFlujo de tareas:")
for i, t in enumerate(crew.tasks, 1):
    ctx = " (usa contexto previo)" if t.context else ""
    print(f"  {i}. {t.agent.role}{ctx}")
print("\n🎯 Cableado OK — listo para kickoff con claves reales.")
