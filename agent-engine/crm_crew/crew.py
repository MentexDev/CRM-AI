"""
Crew del CRM · Agent — jerarquía CEO → Brand Manager NINA → Creador de Contenido.

Replica con un framework agéntico real (CrewAI) la estructura que hoy viven los
agentes del CRM, pero con delegación de roles de verdad. El Brain, la memoria y las
acciones del flujo entran como herramientas — no se reescribe nada del CRM.

Diseño anti-bucle: la "delegación" es el paso secuencial de contexto (salida del CEO
→ entrada del BM → entrada del Creador), y cada tarea expone SOLO las herramientas que
necesita. Así el agente no puede quedarse releyendo el Brain/memoria en bucle.
"""

import os

import litellm
from crewai import Agent, Crew, Process, Task, LLM

from .tools.brain_tool import QueryBrainTool
from .tools.memory_tool import RecallMemoryTool, SaveMemoryTool
from .tools.action_tool import CreateTaskTool, RequestApprovalTool
from .tools.commerce_tool import WebSearchTool

# IDs reales de los agentes en Supabase (estables). Override por env si cambian.
CEO_ID = os.environ.get("CEO_AGENT_ID", "143d47c7-3d5a-4846-adda-8162ba86eb96")
BM_NINA_ID = os.environ.get("BM_NINA_AGENT_ID", "827ba47b-d467-402f-9392-ebe80654adc5")

# Reintento con backoff ante respuestas vacías / 429 transitorios del proveedor.
litellm.num_retries = 3


def _llm() -> LLM:
    # Configurable por env. Por defecto OpenRouter · llama-3.3-70b (sin límite de Groq).
    return LLM(
        model=os.environ.get("MODEL", "openrouter/meta-llama/llama-3.3-70b-instruct"),
        temperature=0.3,
    )


def build_crew(directive: str) -> Crew:
    llm = _llm()
    nina_brand = os.environ.get("NINA_BRAND_ID", "")

    brain = QueryBrainTool(brand_id=nina_brand)
    bm_recall = RecallMemoryTool(agent_id=BM_NINA_ID)
    bm_save = SaveMemoryTool(agent_id=BM_NINA_ID, brand_id=nina_brand)
    bm_create_task = CreateTaskTool(agent_id=BM_NINA_ID)
    bm_request_approval = RequestApprovalTool(agent_id=BM_NINA_ID)
    web = WebSearchTool()

    # ---- Agentes ----
    # allow_delegation=False: la jerarquía se expresa con el flujo secuencial de tareas,
    # no con el tool "Delegate work" (que provocaba ejecución anidada y bucles).
    ceo = Agent(
        role="CEO Global de Mentex Holding",
        goal=(
            "Traducir las directivas de la Junta en un objetivo de negocio claro y "
            "delegarlo en la marca correcta, maximizando el desempeño coordinado."
        ),
        backstory=(
            "Diriges un holding de marcas de ropa colombianas y reportas a la Junta. "
            "No ejecutas tú mismo: defines el qué y el porqué; el cómo lo resuelve el "
            "Brand Manager. Eres estratégico, directo y mides en resultados."
        ),
        llm=llm,
        allow_delegation=False,
        max_iter=6,
        verbose=True,
    )

    brand_manager = Agent(
        role="Brand Manager de NINA",
        goal="Convertir el objetivo del CEO en acción concreta para NINA, fundamentada en el Brain.",
        backstory=(
            "Gestionas la marca NINA. Eres decidido: consultas lo que necesitas UNA vez "
            "y pasas a la acción. Respetas los guardrails (todo gasto pasa por aprobación)."
        ),
        llm=llm,
        allow_delegation=False,
        max_iter=8,
        verbose=True,
    )

    creador = Agent(
        role="Creador de Contenido de NINA",
        goal="Producir piezas (copies, conceptos) fieles a la voz de NINA y al brief.",
        backstory=(
            "Creas contenido para NINA. Consultas el Brain una vez para clavar el tono "
            "y entregas piezas pulidas, listas para revisión."
        ),
        llm=llm,
        allow_delegation=False,
        max_iter=6,
        verbose=True,
    )

    # ---- Tareas: discretas, de un solo propósito, con tools restringidas por tarea ----
    planear = Task(
        description=(
            f"La Junta envía esta directiva:\n\n«{directive}»\n\n"
            "Como CEO, interpreta el objetivo de negocio, define el porqué y formula un "
            "encargo claro para el Brand Manager de NINA: qué quieres lograr, no el cómo."
        ),
        expected_output="Un encargo estratégico breve (3–5 líneas) para el Brand Manager de NINA.",
        agent=ceo,
    )

    brief = Task(
        description=(
            "Recibes el encargo del CEO. Haz EXACTAMENTE esto y nada más:\n"
            "1) Llama recall_memory UNA vez (aprendizajes de campañas pasadas).\n"
            "2) Llama query_brain UNA vez (voz de marca, políticas, aprendizajes).\n"
            "3) Llama web_search UNA vez (tendencias actuales relevantes para la campaña).\n"
            "4) Con eso, escribe el brief. NO vuelvas a llamar herramientas de lectura."
        ),
        expected_output=(
            "Un brief para el Creador: objetivo, tono/voz de NINA (citando Brain y memoria), "
            "una tendencia actual de web_search, mensajes clave y entregables concretos."
        ),
        agent=brand_manager,
        tools=[bm_recall, brain, web],
        context=[planear],
    )

    registrar = Task(
        description=(
            "Con el brief ya definido, ejecuta DOS acciones reales en el CRM y termina:\n"
            "1) create_task: crea la tarea de producir las piezas (prioridad 2).\n"
            "2) request_approval con trigger 'expense': pide aprobación del presupuesto "
            "de pauta a la Junta. NUNCA gastes sin aprobación.\n"
            "No llames ninguna otra herramienta."
        ),
        expected_output="Confirmación de la tarea creada y de la aprobación solicitada (con sus IDs).",
        agent=brand_manager,
        tools=[bm_create_task, bm_request_approval],
        context=[brief],
    )

    aprender = Task(
        description=(
            "Guarda en tu memoria, con save_memory (kind 'learning'), la decisión clave de "
            "esta campaña en una sola frase. Llama la herramienta UNA vez y termina."
        ),
        expected_output="Confirmación de que el aprendizaje quedó guardado.",
        agent=brand_manager,
        tools=[bm_save],
        context=[brief],
    )

    producir = Task(
        description=(
            "Con el brief del Brand Manager, llama query_brain UNA vez si necesitas precisar "
            "el tono, y produce las piezas de contenido para NINA."
        ),
        expected_output="2–3 piezas de contenido (copies/conceptos) fieles a la voz de NINA.",
        agent=creador,
        tools=[brain],
        context=[brief],
    )

    return Crew(
        agents=[ceo, brand_manager, creador],
        tasks=[planear, brief, registrar, aprender, producir],
        process=Process.sequential,
        verbose=True,
    )
