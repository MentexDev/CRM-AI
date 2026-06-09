# 🧠 Brain — Manual de Arquitectura y Operación

> Memoria institucional auto-evolutiva del holding **Mentex**.
> Sistema RAG híbrido (vector + full-text + grafo) con auto-sanación,
> evolución autónoma (Protocolo Aetherna) e ingestión desde Obsidian.

**Proyecto Supabase:** `crm-ai` · `ccaufudzkgvrdxwmazwk` · región `sa-east-1`
**Stack:** Supabase (Postgres 17 + pgvector + pg_cron + pg_net) · Deno Edge Functions · OpenAI embeddings · Groq LLM

---

## 1. Mapa de la Arquitectura Completa

### 1.1 Las 7 tablas del Brain

| Tabla | Propósito | Detalles técnicos |
|---|---|---|
| `knowledge_documents` | Documentos fuente ingestados | `status`: pending→ingesting→ingested/failed/orphaned · `chunk_count` desnormalizado vía trigger |
| `knowledge_chunks` | Fragmentos vectorizados | `embedding vector(1536)` con índice **HNSW** · `content_tsv` columna generada (FTS español) · índice GIN |
| `knowledge_entities` | Nodos del grafo de conocimiento | `kind`: product/customer/decision/campaign/person/concept/event/metric · HNSW + trigram para fuzzy search · `mention_count` |
| `knowledge_relations` | Aristas del grafo | `predicate` + `confidence` (0–1) · unique edge (sin duplicados) |
| `brain_health_log` | Historial de auto-sanación | `health_score` (0–100) + métricas de cada corrida del doctor |
| `brain_evolution_log` | Registro del Protocolo Aetherna | qué aprendió, qué agente, qué tarea, cuántos chunks |
| `obsidian_sync_state` | Control de sync Obsidian | `content_hash` SHA-256 (anti-reingesta) · vínculo a documento + entidad de nota |

**Extensiones activas:** `vector` `pg_net` `pg_trgm` `unaccent` `pg_cron` `supabase_vault`
**Config FTS:** `spanish_unaccent` (español con normalización de acentos)

### 1.2 Funciones SQL (RPC)

| Función | Qué hace |
|---|---|
| `search_knowledge_chunks(brand, embedding, fts, limit, source_kind)` | **Retrieval híbrido: 70% vector + 20% FTS + 10% importancia** |
| `search_knowledge_entities(brand, embedding, limit)` | Búsqueda semántica de entidades del grafo |
| `search_agent_memory(agent, embedding, limit)` | Memoria semántica de agentes (reemplaza ILIKE) |
| `increment_chunk_access(ids[])` | Sube `access_count` de chunks consultados |
| `find_duplicate_chunks(threshold, limit)` | Detecta chunks con cosine > 0.97 |
| `run_brain_doctor()` / `run_obsidian_sync()` | Wrappers que disparan las Edge Functions vía pg_net |
| `brain_status` (vista) | Snapshot ejecutivo de salud del brain en una query |

> Todas las funciones con operador `<=>` usan `search_path = public, extensions`
> (pgvector vive en el schema `extensions` en Supabase).

### 1.3 Edge Functions

| Función | Ver. | JWT | Propósito |
|---|---|---|---|
| `ingest-document` | v3 | no | Pipeline completo: limpieza → chunking → embeddings → entidades → relaciones |
| `query-brain` | v1 | no | Consulta híbrida standalone (vector + FTS + grafo) |
| `auto-distill` | v1 | no | **Protocolo Aetherna** — destila learnings de tareas completadas |
| `brain-doctor` | v1 | no | Auto-sanación + health score |
| `obsidian-sync` | v1 | no | Sincroniza bucket Obsidian → brain + grafo de wiki-links |
| `run-agent-step` | v18 | sí | Runtime de agentes (tareas de fondo) — dispara auto-distill |
| `chat-with-agent` | v5 | sí | Chat síncrono usuario↔agente |
| `execute-approval` | v3 | sí | Ejecuta acciones aprobadas por la Junta (incl. `create_agent`) |

**Tools del Brain disponibles para agentes:** `query_brain` · `ingest_document` · `create_agent` (solo CEO Global)

### 1.4 Crons activos (pg_cron)

| Job | Schedule | Acción |
|---|---|---|
| `crm-ai-heartbeat` | `* * * * *` (cada minuto) | Despierta agentes con tareas pendientes |
| `brain-doctor-hourly` | `0 * * * *` (cada hora) | Auto-sanación del brain |
| `obsidian-sync-15min` | `*/15 * * * *` (cada 15 min) | Absorbe notas de Obsidian |

---

## 2. Protocolo Aetherna y Auto-Sanación

### 2.1 Protocolo Aetherna — el brain que crece solo

Cada vez que un agente completa una tarea (`finish_task` exitoso), el brain aprende:

```
Agente llama finish_task  ✅
        ↓ (fire-and-forget, no bloquea al agente)
run-agent-step dispara → auto-distill
        ↓
1. Lee el historial completo de la tarea (mensajes + resultado)
2. Pase LLM: extrae 3–7 learnings concretos y reutilizables
3. Ingesta cada learning como knowledge_chunk (source_kind='distillation')
4. Registra en brain_evolution_log (qué, quién, cuándo)
        ↓
El brain queda MÁS INTELIGENTE para la próxima tarea similar
```

**Comprobado en producción:** en una negociación de descuento, el primer intento falló
por falta de política clara. Aetherna destiló ese aprendizaje
(*"la falta de políticas de descuentos genera respuestas incompletas"*), lo inyectó al brain,
y en el siguiente intento el agente ya tenía ese contexto disponible vía `query_brain`.
**El sistema aprendió de su propio error sin intervención humana.**

### 2.2 Auto-Sanación — `brain-doctor-hourly`

Cada hora, sin que nadie mueva un dedo:

```
pg_cron → run_brain_doctor() → brain-doctor edge function
        ↓
1. RE-EMBEBE  chunks con embedding NULL (batch de 50)
2. DEDUPLICA  chunks con cosine > 0.97 → marca is_duplicate=true (mantiene el más viejo)
3. DETECTA    documentos huérfanos (ingested sin chunks) → status='orphaned'
4. CALCULA    health_score (0–100):
              100 − (50% × ratio sin-embedding) − (30% × ratio duplicados) − (20% × ratio huérfanos)
5. REGISTRA   todo en brain_health_log
6. ALERTA     si health_score < 70 → crea tarea PRIORIDAD 1 para el CEO Global
```

El brain se vigila, se repara y escala problemas a la dirección automáticamente.

---

## 3. Guía de Ingestión desde Obsidian

### 3.1 Configuración del plugin (una sola vez)

Instala **Remotely Save** en Obsidian (Settings → Community plugins) y configúralo como **S3**:

| Campo | Valor |
|---|---|
| **Service** | S3 (or compatible) |
| **Endpoint** | `https://ccaufudzkgvrdxwmazwk.supabase.co/storage/v1/s3` |
| **Region** | `sa-east-1` |
| **Bucket** | `obsidian-vault` |
| **Access Key ID** | *(generar en Supabase → Project Settings → Storage → S3 Access Keys)* |
| **Secret Access Key** | *(idem)* |

Tras configurar, presiona **Sync**. El plugin sube tu bóveda preservando la estructura de carpetas.

### 3.2 Mapeo de marca — lógica híbrida

El sistema decide a qué marca pertenece cada nota así (en orden de prioridad):

```
1. Frontmatter override  →  ---  brand: nina  ---   (gana siempre)
2. Carpeta raíz          →  NINA/colecciones.md  →  marca "nina"
3. Sin resolución        →  la nota se omite (no se ingesta huérfana)
```

Ejemplo de nota bien formada:

```markdown
---
brand: nina
tags: [colecciones, 2025]
title: Colección Verde Vivo
---
# Colección Verde Vivo

La colección conecta con [[Valentina]] y [[Moda Consciente]].
El ancla es el [[Vestido Lino Crudo|vestido estrella]].
```

### 3.3 Cómo los `[[wiki-links]]` se vuelven grafo

```
La NOTA               →  knowledge_entity (kind: concept)
Cada [[wiki-link]]    →  knowledge_relation
                          source = entidad de la nota
                          target = entidad destino (se crea "fantasma" si no existe)
                          predicate = "menciona"
                          confidence = 1.0  ← link escrito por humano = confianza total
```

El parser maneja:
- **Alias:** `[[Valentina|la cliente]]` → captura `Valentina`
- **Anclas:** `[[Política#15%]]` → captura `Política`
- **Idempotencia:** si el `content_hash` no cambió, salta la nota (no re-ingesta ni re-embebe)
- **Entidades fantasma:** un link a una nota que aún no existe crea un placeholder que se completa cuando esa nota se ingesta después (igual que Obsidian)

El flujo es automático cada 15 minutos. Editas → guardas → en ≤15 min el brain lo absorbió.

---

## 4. Comandos de Emergencia / Mantenimiento

### 4.1 Ver el estado de salud del brain (la query maestra)

```sql
select * from brain_status;
```

Devuelve en una sola fila: docs totales/ingestados/fallidos, chunks totales/sin-embedding/duplicados,
entidades, relaciones, último health_score y fecha del último chequeo, eventos de evolución y
chunks auto-destilados.

### 4.2 Forzar corridas manuales (sin esperar al cron)

```sql
-- Forzar auto-sanación AHORA
select run_brain_doctor();

-- Forzar sync de Obsidian AHORA
select run_obsidian_sync();
```

O vía HTTP directo (las funciones tienen verify_jwt=false):

```bash
curl -X POST "https://ccaufudzkgvrdxwmazwk.supabase.co/functions/v1/brain-doctor" -d '{}'
curl -X POST "https://ccaufudzkgvrdxwmazwk.supabase.co/functions/v1/obsidian-sync" -d '{}'
```

### 4.3 Re-indexar / re-ingestar un documento manualmente

```bash
curl -X POST "https://ccaufudzkgvrdxwmazwk.supabase.co/functions/v1/ingest-document" \
  -H "Content-Type: application/json" \
  -d '{
    "brand_id": "<uuid-de-la-marca>",
    "title": "Título del documento",
    "content": "# Contenido en markdown...",
    "source_kind": "manual"
  }'
```

### 4.4 Probar una consulta al brain manualmente

```bash
curl -X POST "https://ccaufudzkgvrdxwmazwk.supabase.co/functions/v1/query-brain" \
  -H "Content-Type: application/json" \
  -d '{ "brand_id": "<uuid>", "query": "política de descuentos", "limit": 5 }'
```

### 4.5 Diagnóstico de chunks problemáticos

```sql
-- Chunks sin embedding (los recoge el brain-doctor)
select count(*) from knowledge_chunks where embedding is null and is_duplicate = false;

-- Documentos fallidos
select id, title, status, created_at from knowledge_documents where status = 'failed';

-- Forzar re-embedding de un documento: borra sus chunks (cascade) y re-ingesta
delete from knowledge_documents where id = '<doc-uuid>';
-- luego re-llamar ingest-document con el mismo contenido
```

### 4.6 Inspeccionar el grafo de conocimiento de una marca

```sql
select se.name as origen, kr.predicate, te.name as destino, kr.confidence
from knowledge_relations kr
join knowledge_entities se on se.id = kr.source_entity_id
join knowledge_entities te on te.id = kr.target_entity_id
where kr.brand_id = '<uuid-marca>'
order by kr.confidence desc;
```

### 4.7 Ver la evolución autónoma del brain (qué ha aprendido solo)

```sql
select b.created_at, a.name as agente, t.title as tarea, b.learnings
from brain_evolution_log b
left join agents a on a.id = b.source_agent_id
left join tasks  t on t.id = b.source_task_id
order by b.created_at desc
limit 20;
```

### 4.8 Gestión de crons

```sql
-- Ver todos los crons
select jobname, schedule, active from cron.job order by jobid;

-- Pausar / reactivar un cron
update cron.job set active = false where jobname = 'obsidian-sync-15min';
update cron.job set active = true  where jobname = 'obsidian-sync-15min';

-- Ver historial de ejecuciones (últimas corridas)
select jobid, status, return_message, start_time
from cron.job_run_details
order by start_time desc limit 20;
```

### 4.9 Secrets requeridos en Supabase (Edge Functions → Secrets)

| Secret | Uso | Obligatorio |
|---|---|---|
| `OPENAI_API_KEY` | Embeddings (text-embedding-3-small) | **Sí** — sin esto el brain no embebe |
| `GROQ_API_KEY` | LLM de agentes + extracción de entidades | Sí |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Runtime interno | Auto |
| `TAVILY_API_KEY` | Tool web_search | Opcional |

> En Vault está guardado `project_url` (usado por los wrappers de cron). No hardcodear URLs.

---

## 5. Costos de Referencia

| Item | Costo |
|---|---|
| Embeddings (text-embedding-3-small) | $0.02 / 1M tokens |
| Embeber 1 documento de 5 páginas | ~$0.00006 |
| 1 consulta `query_brain` | ~$0.000001 |
| 1 destilación Aetherna | ~$0.00001 |
| `brain-doctor` cuando no hay nada que reparar | **$0** (solo cuenta) |
| pgvector storage / Edge Functions runtime | incluido en el plan |

Embeber toda la base de conocimiento de una marca cuesta **centavos**.

---

## 6. Diagrama de Capas (visión de conjunto)

```
┌─────────────────────────────────────────────────────────────┐
│  AGENTES  (CEO Global · Brand Managers · Especialistas)     │
│  usan tools → query_brain · ingest_document · create_agent  │
├─────────────────────────────────────────────────────────────┤
│  RUNTIME   run-agent-step (v18) · chat-with-agent (v5)      │
│  ↳ al completar tarea → dispara Protocolo Aetherna          │
├─────────────────────────────────────────────────────────────┤
│  RETRIEVAL híbrido   70% vector + 20% FTS + 10% importancia │
│  ↳ search_knowledge_chunks + search_knowledge_entities      │
├─────────────────────────────────────────────────────────────┤
│  KNOWLEDGE STORE   documents · chunks · entities · relations│
│  (pgvector HNSW + FTS español + grafo)                      │
├─────────────────────────────────────────────────────────────┤
│  INGESTIÓN   ingest-document · obsidian-sync · auto-distill │
│  ↳ markdown · web · conversaciones · Obsidian wiki-links    │
├─────────────────────────────────────────────────────────────┤
│  AUTOMATIZACIÓN   3 crons (heartbeat · doctor · obsidian)   │
│  AUTO-SANACIÓN    brain-doctor + brain_health_log           │
├─────────────────────────────────────────────────────────────┤
│  EMBEDDINGS   OpenAI text-embedding-3-small (1536 dims)     │
└─────────────────────────────────────────────────────────────┘
```

---

*El Brain está vivo, consultable, auto-evolutivo, auto-sanable, con voz de marca,*
*capaz de crear agentes y alimentado por Obsidian — todo en piloto automático.* 🧠✨
