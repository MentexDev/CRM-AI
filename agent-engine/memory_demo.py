"""
Demo de MEMORIA PERSISTENTE por agente — sin gastar tokens del LLM.

Simula dos sesiones distintas del mismo agente (Brand Manager NINA):

  Sesión 1 (hoy):     el agente GUARDA un aprendizaje.
  Sesión 2 (mañana):  el agente, "arrancando de cero", RECUERDA ese aprendizaje.

Esto es justo lo que aporta Letta (estado persistente), pero corriendo sobre
nuestra Supabase: sin Docker, sin server nuevo.

    python memory_demo.py
"""

from dotenv import load_dotenv

from crm_crew.tools.memory_tool import RecallMemoryTool, SaveMemoryTool

# Brand Manager NINA (inventarista) + marca NINA
BM_NINA = "827ba47b-d467-402f-9392-ebe80654adc5"
NINA_BRAND = "ac009239-c8ca-4b45-99ad-6a804419836c"


def main() -> None:
    load_dotenv()
    recall = RecallMemoryTool(agent_id=BM_NINA)
    save = SaveMemoryTool(agent_id=BM_NINA, brand_id=NINA_BRAND)

    print("=" * 68)
    print("🧠 DEMO · Memoria persistente del Brand Manager NINA (sobre Supabase)")
    print("=" * 68)

    print("\n── SESIÓN 1 (hoy) · el agente guarda lo que aprendió ──")
    learning = (
        "En campañas de fechas especiales, para NINA funciona mejor el ángulo de "
        "AUTENTICIDAD/identidad que el de precio. Mantener descuentos ≤ 15% por política."
    )
    print(f"  guardando: «{learning}»")
    print("  →", save._run(content=learning, kind="learning"))

    print("\n── SESIÓN 2 (otro día, sin contexto previo) · el agente recuerda ──")
    pregunta = "¿qué sé sobre cómo enfocar campañas de fechas especiales en NINA?"
    print(f"  pregunta: «{pregunta}»")
    print("  ↓")
    print(recall._run(query=pregunta))

    print("\n" + "=" * 68)
    print("✅ El agente recordó entre sesiones — memoria persistente, sin Docker.")
    print("=" * 68)


if __name__ == "__main__":
    main()
