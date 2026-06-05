"""
Punto de entrada del POC.

Uso:
    python -m crm_crew.main
    python -m crm_crew.main "Lanza una promo de NINA para San Valentín"
"""

import sys

from dotenv import load_dotenv

from .crew import build_crew

DEFAULT_DIRECTIVE = (
    "Quiero impulsar las ventas de NINA para el Día de la Madre. "
    "Necesito una mini-campaña de contenido coherente con la voz de la marca."
)


def run() -> None:
    load_dotenv()
    directive = " ".join(sys.argv[1:]).strip() or DEFAULT_DIRECTIVE

    print("\n" + "=" * 70)
    print("🏛️  CRM · Agent — POC motor agéntico (CrewAI)")
    print("=" * 70)
    print(f"🟢 Directiva de la Junta:\n   {directive}\n")

    crew = build_crew(directive)
    result = crew.kickoff()

    print("\n" + "=" * 70)
    print("✅ RESULTADO FINAL")
    print("=" * 70)
    print(result)


if __name__ == "__main__":
    run()
