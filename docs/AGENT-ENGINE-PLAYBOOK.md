# Playbook del Motor de Agentes — guía de trasplante (CRM-AI → Mentex)

> Mapa de instrucciones para llevar el sistema de agentes de este CRM a otro
> proyecto (Mentex). Distingue lo **portable como está** (el motor) de lo que se
> **adapta por proyecto** (tools de dominio, prompts, datos).

---

## 0. Qué es (en una frase)

Un **runtime de agentes en TypeScript** sobre **Supabase** (Postgres + Edge Functions
Deno) con: LLM multi-proveedor por-agente, streaming en vivo, loop de tool-calling,
tools como código (registry versionado), memoria/RAG, y un frontend React con chat +
**canvas split-view** (el trabajo del agente es visible). Sin frameworks pesados
(no CrewAI/LangChain) — plomería propia, mínima y auditada.

---

## 1. Arquitectura — las 4 capas

```
┌─ FRONTEND (React/Vite) ─────────────────────────────────────────────┐
│  Chat (streaming por realtime) · selector de proveedor+modelo ·      │
│  Canvas split-view (drawer + iframe) · conversaciones · tareas       │
└───────────────┬──────────────────────────────────────────────────────┘
                │ supabase.functions.invoke + realtime (postgres_changes)
┌─ EDGE FUNCTIONS (Deno) ─────────────────────────────────────────────┐
│  chat-with-agent (chat sync) · run-agent-step (tareas) · heartbeat   │
│  (cron) · query/ingest (Brain) · execute-approval                    │
└───────────────┬──────────────────────────────────────────────────────┘
                │
┌─ EL MOTOR (_shared, TS puro — PORTABLE) ────────────────────────────┐
│  llm.ts (proveedores) · tool-kit.ts (defineTool/ToolRegistry) ·      │
│  agent_chat.ts (loop chat) · agent_step.ts (loop tareas) ·           │
│  tools.ts (handlers) · tool-specs.ts (schemas) · auth.ts · db.ts     │
└───────────────┬──────────────────────────────────────────────────────┘
                │
┌─ POSTGRES (Supabase) ───────────────────────────────────────────────┐
│  agents · conversations · messages · tasks · tool_calls ·            │
│  tools_registry · agent_memory · (Brain: chunks/embeddings) · RLS    │
└──────────────────────────────────────────────────────────────────────┘
```

**Regla de oro de portabilidad:** el **MOTOR** (capa 3) y el **modelo de datos** (capa 4)
son **agnósticos del dominio → se copian casi tal cual**. Lo que cambia en Mentex:
las **tools** (capacidades del negocio), los **system prompts** y los **datos/marcas**.

---

## 2. El MOTOR (portable como está)

| Archivo (`supabase/functions/_shared/`) | Qué hace | ¿Portar? |
|---|---|---|
| `llm.ts` | Proveedores LLM: `OpenAICompatProvider` (Groq/OpenAI/Ollama/OpenRouter — solo cambia el baseURL) + `AnthropicProvider` (traduce formato). `makeProvider(name)`. `complete()` + `completeStream()`. `isRateOrSizeLimitError()`. | ✅ tal cual |
| `tool-kit.ts` | `defineTool()` (schema+handler+metadata juntos) + `ToolRegistry` (get/all/definitions/run/seedRows). Guards anti-drift. | ✅ tal cual |
| `tools.ts` | Los **handlers** de cada tool + `loadTools/runTool/toToolDefinitions` (leen del registry) + **cap estructural** del resultado al contexto del LLM. | 🔧 base portable; **los handlers de dominio se reemplazan** |
| `tool-specs.ts` | Schemas de las tools (generado desde `tools_registry`, versionado). | 🔧 se regenera por proyecto |
| `agent_chat.ts` | Loop de **chat síncrono** usuario↔agente: conversaciones, streaming, tool-calling (`while iterations < MAX`), degradación elegante, auth de marca. | ✅ tal cual |
| `agent_step.ts` | Loop **autónomo de tareas** (lo dispara el cron/heartbeat): lee tarea activa, tool-calling, `finish_task`/approval/escalation. | ✅ tal cual |
| `auth.ts` | `requireEngineKey` (X-Engine-Key, fail-closed) para llamadas máquina-a-máquina. | ✅ tal cual |
| `db.ts` | `adminDb()` (service_role) helper. | ✅ tal cual |

**Cómo funciona un turno (ambos loops):**
1. Cargar agente (`provider`, `model`, `system_prompt`, `allowed_tools`).
2. Cargar historial → construir `messages` (los resultados de tool **se capean** al contexto).
3. `provider.complete/completeStream({model, messages, tools})`.
4. Si hay `tool_calls` → `toolRegistry.run()` por cada una → persistir resultado → re-iterar.
5. Si no hay tool_calls → terminar. Persistir todo en `messages`/`tool_calls`.

---

## 3. Modelo de datos (Postgres) — portar el esquema

Tablas núcleo (con RLS **brand-scoped**):

- **`agents`** — `id, slug, name, provider, model, system_prompt, allowed_tools (text[]), brand_id, parent_agent_id, status, config (jsonb)`. RLS: `agents_read_by_access` = `brand_id IS NULL OR has_brand_access(brand_id)`; escritura = `is_junta()`.
- **`conversations`** — `id, agent_id, brand_id, title, created_by`. *(Pendiente: acotar el SELECT por marca — ver §7.)*
- **`messages`** — `id, agent_id, task_id, conversation_id, role, content, tool_calls (jsonb), tool_call_id, metadata (jsonb), created_at`. **Guarda el resultado COMPLETO de la tool** (la UI lo lee; el cap es solo para el LLM).
- **`tasks`** — `id, agent_id, brand_id, parent_task_id, title, description, status, priority, due_at, context`.
- **`tool_calls`** — `id, agent_id, task_id, message_id, tool_name, args, result, error, status, duration_ms`.
- **`tools_registry`** — `name, description, category, args_schema (jsonb), requires_approval, is_active`. **Se seedea desde el código** (`supabase/seed/tools_registry.json` vía `ToolRegistry.seedRows()`).
- **`agent_memory`** — memoria semántica del agente (`save_memory`/`search_memory`).
- **Brain/RAG** — tablas de chunks + embeddings (pgvector) para `query_brain`/`ingest_document`.
- Helpers SQL: `has_brand_access(brand_id)`, `is_junta()` (multi-tenant + roles).

---

## 4. Las TOOLS — lo que se ADAPTA en Mentex

Hoy hay **20 tools** (categorías): core (memoria, delegación, aprobaciones, KPIs, crear agentes), shopify (productos/órdenes/clientes/inventario — lectura), knowledge (Brain), web (search), image (generar), communication (`send_email`, `compose_email`).

**Para Mentex:** mantén las **core/knowledge/web/communication** (genéricas) y **reemplaza las de dominio** (shopify) por las de Mentex. Patrón para **agregar una tool**:

1. **Handler** en `tools.ts`: `async function miTool(ctx, args) { … return { ok, data } }`.
2. **Registrar** en el map `HANDLERS`: `mi_tool: miTool`.
3. **Spec** en `tool-specs.ts` (TOOL_SPECS): `{ name, description, category, parameters (JSON Schema), requiresApproval, isActive }`.
4. **Seed a la BD**: `toolRegistry.seedRows()` → upsert a `tools_registry` (para el display + asignación).
5. **Asignar** al agente: añadir el nombre a `agents.allowed_tools`.
6. Los **guards anti-drift** del registry fallan al cargar si un spec no tiene handler (o viceversa) → imposible desincronizar.

> Para efectos sensibles/externos (enviar correo, escribir en sistemas): valida entradas
> en el handler (formato, topes) y marca `requiresApproval: true`. **Ojo:** hoy el runtime
> aún no honra `requiresApproval` (ver §7) — gátalo en el handler o ciérralo en F5.

---

## 5. Frontend (React) — adaptar al diseño de Mentex

| Archivo | Qué portar |
|---|---|
| `src/hooks/useAgentMessages.js` | Suscripción **realtime** a `messages` (event `*` → maneja INSERT y UPDATE). **Clave para el streaming**: el backend hace UPDATE del mensaje y el front lo ve en vivo. |
| `src/hooks/useConversations.js`, `useAgents.js`, `useAgentTasks.js` | Lectura de agentes/conversaciones/tareas. |
| `src/pages/admin/Agents.jsx` | `ChatComposer` (envío + streaming + selector provider+model + **navegación instantánea** con `crypto.randomUUID()`), `MessagesTab` (chat + optimistic UI), **`EmailCanvas`** (canvas split-view: drawer animado, divisor arrastrable, iframe sandboxed). |
| `src/pages/admin/AdminLayout.jsx` | Sidebar + auto-colapso cuando el canvas abre (`?canvas=1`). |

**Acoplamiento crítico:** el streaming es **backend+frontend**. El backend inserta un
mensaje vacío y lo va llenando con `UPDATE` (throttled); el front escucha `UPDATE` por
realtime. **Desplegar ambos juntos** o el chat muestra burbujas vacías.

**Canvas (render hints):** cada tool puede declarar `render: 'email'|'browser'|'doc'|…`
(en `tool-kit.ts`). Hoy el panel `email` renderiza HTML en un `<iframe srcDoc sandbox="">`.
El artefacto sale como `{ ok, data: { kind:'email', subject, html } }` y el front lo detecta.

---

## 6. Edge Functions + Secrets

**Funciones a portar:** `chat-with-agent` (chat sync, **valida JWT + acceso de marca**),
`run-agent-step` (tareas, **X-Engine-Key**), `heartbeat` (cron → corre steps in-process),
`query-brain`/`ingest-document`/`brain-proxy` (RAG), `execute-approval`.

**Secrets (Supabase → Edge Functions):**
- LLM: `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `OLLAMA_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` (los que uses).
- Email: `RESEND_API_KEY`, `RESEND_FROM` (`"NINA <noreply@tudominio.com>"` — **dominio verificado en Resend**).
- M2M: `ENGINE_API_KEY` (para brain-proxy/run-agent-step).
- Dominio: las de Mentex (su API equivalente a Shopify, etc.).
- `SUPABASE_URL`/`SERVICE_ROLE_KEY`/`ANON_KEY` los inyecta Supabase.

---

## 7. Seguridad (NO omitir al portar)

- **Auth usuario:** `chat-with-agent` valida el JWT **y** que el caller pueda leer el agente con SU sesión (RLS brand-scoped) → aislamiento multi-tenant. **Esto es la única barrera de marca** porque el turno corre con `service_role`.
- **Auth M2M:** `requireEngineKey` (fail-closed) en funciones máquina-a-máquina.
- **RLS brand-scoped** en todas las tablas (`has_brand_access`).
- **Tools con efectos:** validar entradas + topes en el handler.
- **Canvas iframe:** `sandbox=""` (sin scripts).

**⚠️ Deuda conocida a cerrar en Mentex (de la auditoría C-A-R, ver `car-audit-f2f3-pending`):**
1. `conversations_select` hoy permite a CUALQUIER usuario leer TODAS las conversaciones → **acotar por marca**.
2. El runtime **no honra `requiresApproval`** (solo `request_approval`/`escalate_to_ceo` bloquean) → implementar el gate genérico (crear approval + bloquear turno) antes de exponer tools de efecto real.

---

## 8. Mapa de instrucciones — orden de trasplante a Mentex

1. **DB:** crear el esquema (tablas de §3) + helpers `has_brand_access`/`is_junta` + RLS + pgvector (Brain). Migraciones en `supabase/migrations`.
2. **Motor:** copiar `_shared/` (llm.ts, tool-kit.ts, agent_chat.ts, agent_step.ts, auth.ts, db.ts) **tal cual**.
3. **Tools de dominio:** en `tools.ts` reemplazar los handlers de Shopify por los de Mentex; mantener core/knowledge/web/communication. Registrar en `HANDLERS`.
4. **Specs + seed:** poblar `tool-specs.ts` (o generarlo) → `seedRows()` → upsert a `tools_registry`.
5. **Edge Functions:** desplegar chat-with-agent, run-agent-step, heartbeat (+ Brain). `supabase functions deploy …`.
6. **Secrets:** setear las llaves (§6).
7. **Cron:** pg_cron → `heartbeat` cada 1 min (corre las tareas autónomas).
8. **Frontend:** portar los hooks + el chat + el canvas (§5), adaptados al diseño de Mentex. Recordar el acoplamiento del streaming.
9. **Agentes:** crear filas en `agents` (provider+model+system_prompt+allowed_tools+brand_id).
10. **Seguridad:** cerrar la deuda de §7 ANTES de producción.
11. **Auditar:** correr el ciclo **C-A-R** (construir → auditar adversarial → arreglar) sobre lo portado.

---

## 9. Lecciones / gotchas (nos costaron tiempo — ahórratelos)

- **Proveedores OpenAI-compatibles** (Groq, Ollama Cloud `ollama.com/v1`, OpenRouter `openrouter.ai/api/v1`) = **un solo `OpenAICompatProvider`, solo cambia el baseURL**. Kimi (OpenRouter `moonshotai/kimi-k2.5`) anduvo excelente para tool-calling + 262k contexto.
- **Provider+model son por-agente** (columnas en `agents`); el backend NO infiere el provider del modelo → setéalo explícito.
- **Opus 4.x rechaza `temperature`** (400) — el `AnthropicProvider` lo omite para opus-4-(7|8).
- **Cap del resultado de tool:** recortar **estructuralmente** (por items del array, JSON válido) SOLO para el contexto del LLM; en `messages.content` guardar el **JSON completo** (lo lee la UI). Si capeas el que lee la UI → "Tool falló" en resultados grandes exitosos.
- **Streaming = realtime UPDATE**; desplegar backend+frontend juntos.
- **Navegación instantánea:** el cliente genera el `conversation_id` (UUID) y el backend lo honra → pero **validar acceso de marca** (si no, IDOR).
- **Resize del canvas:** un `<iframe>` se traga los eventos del puntero → poner un **overlay transparente** durante el arrastre.
- **Deploy:** Edge Functions con `supabase functions deploy` (bundle en la nube, "Docker not running" es inofensivo). Frontend con `wrangler` — si Node 20, usar `npx -y wrangler@4.86.0 deploy`.
- **Resend:** para enviar a cualquier correo, **verificar dominio** + setear `RESEND_FROM`; el remitente de prueba solo entrega al dueño de la cuenta.

---

## 10. Protocolo de trabajo (cómo lo construimos)

**C-A-R — Construir → Auditar → Reflexionar:** tras construir, correr una **auditoría
adversarial** (varios revisores con lentes distintas + refutación de cada hallazgo) en
turno aparte. En este proyecto atrapó 3 bugs reales (1 HIGH de seguridad multi-tenant).
Checklist de zonas ciegas del constructor documentado aparte. **No saltarse la auditoría.**
