# 🧠 Motor Agéntico — POC (CrewAI)

Prueba de concepto del **framework agéntico real** para el CRM · Agent de Mentex
Holding. Responde a la observación del capitán Diego: *"esto son LLMs, no agentes"*.

Aquí los agentes dejan de ser un solo prompt y pasan a ser un **equipo con roles y
delegación de verdad** (CrewAI), conservando todo lo que ya construimos: el **Brain**
(RAG + grafo) entra como **herramienta**, no se reescribe nada.

---

## ¿Qué demuestra este POC?

Una directiva de la Junta recorre la jerarquía real de la empresa:

```
Junta (humano)
   │  «Impulsa NINA para el Día de la Madre»
   ▼
CEO Global ───delega──▶ Brand Manager NINA ───delega──▶ Creador de Contenido
                              │                                  │
                              └──── query_brain ────┐    ┌──── query_brain
                                                    ▼    ▼
                              Brain del CRM (Supabase Edge Function `query-brain`)
                              retrieval híbrido: vector + FTS + grafo
```

- **CEO Global** interpreta el objetivo de negocio y delega (no ejecuta).
- **Brand Manager NINA** consulta el Brain (voz, políticas, aprendizajes) y arma un brief.
- **Creador de Contenido** produce las piezas fieles a la marca.

Todo en español, con el **mismo modelo** que el CRM (Groq · `llama-3.3-70b`) y el
**mismo Brain** en producción.

---

## Arquitectura: qué se reusa y qué es nuevo

| Capa | Estado | Detalle |
|------|--------|---------|
| UI React | ✅ se reusa | Sin cambios; en producción hablaría por API al motor |
| **Motor agéntico (CrewAI)** | 🆕 nuevo | Orquesta roles y delegación |
| Brain (RAG + grafo) | ✅ se reusa | Entra como tool `query_brain` vía HTTP |
| Supabase | ✅ se reusa | Sistema de registro / verdad |
| LLM (Groq/OpenAI) | ✅ se reusa | Los "cerebros" intercambiables |

> El motor es el **cuerpo**; el LLM es el cerebro que le enchufas. Exactamente la
> metáfora que pidió Diego.

---

## Requisitos

- Python 3.10–3.13
- Una **GROQ_API_KEY** (la misma del CRM sirve)
- La **anon key** de Supabase (la del frontend, `VITE_SUPABASE_ANON_KEY`)

## Instalación

```bash
cd agent-engine
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env      # y completa GROQ_API_KEY + SUPABASE_ANON_KEY
```

## Ejecutar

```bash
# 1) Demo de MEMORIA PERSISTENTE (rápido, sin gastar LLM)
python memory_demo.py

# 2) Demo de ACCIONES REALES — el agente crea tarea + pide aprobación (sin gastar LLM)
python tools_demo.py

# 2b) Demo de COMERCIO — web_search (Tavily) + inventario con umbral 20u (sin gastar LLM)
python commerce_demo.py

# 3) Crew completo (CEO → BM → Creador: Brain + memoria + acciones reales)
python -m crm_crew.main
python -m crm_crew.main "Lanza una promo de NINA para San Valentín con 15% en blusas"
```

Verás en consola cómo el CEO delega, el Brand Manager **recuerda** sesiones pasadas,
**consulta el Brain**, arma el brief y **guarda** el aprendizaje; y el Creador produce.

### ⚠️ Nota sobre el tier gratis de Groq
El plan **free** de Groq limita a 12k tokens/minuto (6k en `8b-instant`). Una corrida
multi-agente real supera ese tope y se corta con `RateLimitError`. **No es un fallo del
POC** — cada pieza está probada (delegación, Brain y memoria). Para una corrida fluida
de corrido: subir a **Groq Dev Tier** (pago, barato) o usar OpenAI/Anthropic cambiando
`MODEL` en `.env`. El `memory_demo.py` no usa LLM, así que siempre corre limpio.

## Dos capas de memoria (clave para Diego)

| Capa | Qué es | Alcance | Dónde vive |
|------|--------|---------|------------|
| **Brain** (`query_brain`) | Memoria de la **marca**: voz, políticas, productos, grafo | Compartida por todos los agentes de la marca | Supabase (`query-brain`) |
| **Agent memory** (`recall/save_memory`) | Memoria **propia** del agente: lo que él aprendió/decidió | Privada por agente, persiste entre sesiones | Supabase (`agent-memory`) |

> Esto es lo que aporta **Letta** (estado persistente), pero **sobre nuestra Supabase**:
> sin Docker, sin server nuevo, sin vendor nuevo.

## Acciones reales sobre el flujo del proyecto

Los agentes no solo leen: **ejecutan**. Vía la Edge Function `agent-action` escriben en
las mismas tablas que lee la UI del CRM:

| Tool | Acción | Dónde aparece |
|------|--------|---------------|
| `create_task` | Crea una tarea (`status to_do`) | Página **Tareas** |
| `request_approval` | Pide aprobación a la Junta (`pending`) | Página **Aprobaciones** |
| `web_search` | Búsqueda web real (Tavily) | — (insumo del brief) |
| `get_inventory` | Stock por SKU en Shopify | — (lectura) |
| `adjust_inventory` | Ajuste con **umbral 20u** | >20u → **Aprobaciones** |

> Guardrail respetado: las acciones sensibles (gasto, publicar, comunicación externa)
> pasan por **aprobación humana** antes de ejecutarse — el agente nunca actúa solo.

### Idempotencia (importante)
Los modelos LLM, dentro del loop ReAct de CrewAI, **a veces repiten** la misma llamada
a una herramienta antes de cerrar. Para que eso no ensucie el CRM con duplicados,
`agent-action` es **idempotente**: si el agente repite `create_task`/`request_approval`
con el mismo título/resumen, devuelve el registro existente (`deduped: true`) en vez de
crear otro. Así el bucle del LLM es inofensivo. Además, cada agente tiene `max_iter`
para acotar iteraciones, y cada tarea expone solo las herramientas que necesita.

### Sobre el modelo
- `llama-3.3-70b` (default): consulta bien el Brain y **respeta políticas** (descuento ≤15%),
  pero tiende a repetir tool-calls (acotado por idempotencia + max_iter).
- `gpt-4o-mini`: itera menos, pero a veces **se salta el Brain** (puede inventar un 20%).
- Para producción real conviene un modelo fuerte en tool-calling **y** fiel al contexto
  (p.ej. Claude o gpt-4o full) — se cambia con `MODEL` en `.env`, sin tocar código.

---

## Estructura

```
agent-engine/
├── crm_crew/
│   ├── crew.py             # Agentes (roles), tareas y el Crew
│   ├── main.py             # Entrypoint del Crew
│   └── tools/
│       ├── brain_tool.py    # query_brain  → Edge Function query-brain
│       ├── memory_tool.py   # recall/save_memory → Edge Function agent-memory
│       ├── action_tool.py   # create_task / request_approval → Edge Function agent-action
│       └── commerce_tool.py # web_search / get_inventory / adjust_inventory → agent-tools
├── memory_demo.py          # Demo de memoria persistente (sin LLM)
├── tools_demo.py           # Demo de acciones reales en el flujo (sin LLM)
├── commerce_demo.py        # Demo de web_search + inventario con umbral (sin LLM)
├── smoke_test.py           # Valida el cableado del Crew (sin LLM)
├── requirements.txt
├── .env.example
└── README.md
```

---

## Próximos pasos (post-POC)

1. ~~Memoria persistente por agente~~ ✅ **Hecho** sobre Supabase (sin Letta, sin Docker).
2. ~~Conectar acciones del flujo~~ ✅ **Hecho**: `create_task` + `request_approval`.
3. ~~Más tools del CRM~~ ✅ **Hecho**: `web_search` (Tavily), `get_inventory` /
   `adjust_inventory` (Shopify, umbral 20u).
4. **Proceso jerárquico** (`Process.hierarchical`) con el CEO como *manager* que valida.
5. **Resolver el LLM**: OpenRouter (mantiene llama-70b) u OpenAI `gpt-4o-mini` ahora;
   Ollama en VPS con GPU para la fase "infra propia". *(Groq Dev está bloqueado por demanda.)*
6. **Desplegar el motor** (host Python: Railway/Fly/VPS) y exponer un endpoint para la UI.
   *(Cloudflare Workers no sirve: es JS, no corre Python.)*
