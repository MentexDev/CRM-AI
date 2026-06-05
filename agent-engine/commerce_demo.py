"""
Demo de las nuevas tools del CRM en el motor — sin gastar LLM.

  1) web_search (Tavily real)
  2) adjust_inventory con UMBRAL: delta 50 (>20) → crea aprobación, NO ejecuta

    python commerce_demo.py
"""

from dotenv import load_dotenv

from crm_crew.tools.commerce_tool import WebSearchTool, AdjustInventoryTool

BM_NINA = "827ba47b-d467-402f-9392-ebe80654adc5"


def main() -> None:
    load_dotenv()
    web = WebSearchTool()
    adjust = AdjustInventoryTool(agent_id=BM_NINA)

    print("=" * 68)
    print("🛠️  DEMO · Nuevas capacidades del Crew (web + inventario con umbral)")
    print("=" * 68)

    print("\n1) web_search (Tavily) — tendencias para NINA:")
    print(web._run(query="tendencias moda femenina sostenible Colombia 2026")[:400])

    print("\n2) adjust_inventory — delta 50 (>20 → debe pedir aprobación, NO ejecutar):")
    print("  →", adjust._run(sku="NINA-DEMO", location_id="123", delta=50, reason="reposición"))

    print("\n" + "=" * 68)
    print("✅ El agente puede investigar la web y tocar inventario con guardrail de aprobación.")
    print("=" * 68)


if __name__ == "__main__":
    main()
