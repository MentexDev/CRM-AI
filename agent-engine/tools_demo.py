"""
Demo de ACCIONES REALES sobre el flujo del proyecto — sin gastar LLM.

El Brand Manager NINA:
  1) crea una TAREA real (aparece en la página Tareas del CRM)
  2) pide una APROBACIÓN a la Junta (aparece en Aprobaciones — human-in-the-loop)

    python tools_demo.py
"""

from dotenv import load_dotenv

from crm_crew.tools.action_tool import CreateTaskTool, RequestApprovalTool

BM_NINA = "827ba47b-d467-402f-9392-ebe80654adc5"


def main() -> None:
    load_dotenv()
    create_task = CreateTaskTool(agent_id=BM_NINA)
    request_approval = RequestApprovalTool(agent_id=BM_NINA)

    print("=" * 68)
    print("🛠️  DEMO · El Brand Manager NINA ejecuta acciones reales en el CRM")
    print("=" * 68)

    print("\n1) Crear tarea en el flujo del proyecto:")
    print("  →", create_task._run(
        title="Producir 3 piezas para campaña Día de la Madre",
        description="Copies + concepto visual, alineados a la voz de NINA (autenticidad).",
        priority=2,
    ))

    print("\n2) Pedir aprobación a la Junta (acción sensible = presupuesto):")
    print("  →", request_approval._run(
        summary="Aprobar $4.5M COP de pauta para la campaña 'Regalos que Declaran Libertad' (Día de la Madre).",
        trigger="expense",
    ))

    print("\n" + "=" * 68)
    print("✅ Acciones reales ejecutadas — revísalas en las páginas Tareas y Aprobaciones.")
    print("=" * 68)


if __name__ == "__main__":
    main()
