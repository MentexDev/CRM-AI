// =====================================================================
// Brain · Pipeline de Ingestión de Conocimiento
// Fuente → Limpieza → Chunking → Embeddings → Entidades → Relaciones
// =====================================================================
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@^2'
import OpenAI from 'npm:openai@^4'

// ─────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────

export interface IngestRequest {
  brandId: string
  title: string
  content?: string
  sourceUrl?: string
  sourceKind?: SourceKind
  sourceUri?: string
  agentId?: string
  metadata?: Record<string, unknown>
}

export interface IngestResult {
  documentId: string
  chunksCreated: number
  entitiesCreated: number
  entitiesUpdated: number
  relationsCreated: number
  relationsSkipped: number
  durationMs: number
}

type SourceKind = 'manual' | 'markdown' | 'pdf' | 'web' | 'conversation' | 'obsidian' | 'tool_result'

type EntityKind = 'product' | 'customer' | 'decision' | 'campaign' | 'person' | 'concept' | 'event' | 'metric'

interface Chunk {
  index: number
  content: string
  tokenCount: number
}

interface Entity {
  kind: EntityKind
  name: string
  description: string
}

interface Relation {
  source: string
  predicate: string
  target: string
  confidence: number
}

interface ExtractedGraph {
  entities: Entity[]
  relations: Relation[]
}

// ─────────────────────────────────────────────────────────────────────
// Constantes de chunking
// ─────────────────────────────────────────────────────────────────────

const TARGET_TOKENS   = 500
const OVERLAP_TOKENS  = 50
const CHARS_PER_TOKEN = 4
const TARGET_CHARS    = TARGET_TOKENS  * CHARS_PER_TOKEN  // 2000
const OVERLAP_CHARS   = OVERLAP_TOKENS * CHARS_PER_TOKEN  // 200
const EMBED_BATCH_SIZE = 96

// ─────────────────────────────────────────────────────────────────────
// Entrypoint principal
// ─────────────────────────────────────────────────────────────────────

export async function runIngestPipeline(
  req: IngestRequest,
  db: SupabaseClient,
): Promise<IngestResult> {
  const startedAt = Date.now()
  const openai = buildOpenAIClient()

  // 1. Obtener y limpiar el contenido fuente
  const rawContent = req.content
    ? cleanText(req.content)
    : await fetchAndExtractUrl(req.sourceUrl!)

  if (rawContent.length < 50) {
    throw new IngestError('El contenido está vacío o es demasiado corto (mínimo 50 caracteres)')
  }

  // 2. Crear registro del documento (status: ingesting)
  const { data: doc, error: docErr } = await db
    .from('knowledge_documents')
    .insert({
      brand_id:             req.brandId,
      title:                req.title.trim(),
      content:              rawContent,
      source_kind:          req.sourceKind ?? 'manual',
      source_uri:           req.sourceUri ?? req.sourceUrl ?? null,
      status:               'ingesting',
      metadata:             req.metadata ?? {},
      ingested_by_agent_id: req.agentId ?? null,
    })
    .select('id')
    .single()

  if (docErr) throw new IngestError(`No se pudo crear el documento: ${docErr.message}`)
  const documentId = doc.id

  try {
    return await runPipelineStages(documentId, rawContent, req, db, openai, startedAt)
  } catch (err) {
    // Marcar el documento como fallido antes de relanzar
    await db
      .from('knowledge_documents')
      .update({ status: 'failed', updated_at: new Date().toISOString() })
      .eq('id', documentId)
    throw err
  }
}

// ─────────────────────────────────────────────────────────────────────
// Etapas del pipeline
// ─────────────────────────────────────────────────────────────────────

async function runPipelineStages(
  documentId: string,
  content: string,
  req: IngestRequest,
  db: SupabaseClient,
  openai: OpenAI,
  startedAt: number,
): Promise<IngestResult> {

  // 3. Chunking semántico
  const chunks = chunkMarkdown(content)

  // 4. Embeber todos los chunks en batch
  const chunkEmbeddings = await embedBatch(openai, chunks.map(c => c.content))

  // 5. Insertar chunks — preserva el source_kind si es uno válido para chunks
  const validChunkKinds = ['conversation', 'obsidian', 'distillation']
  const chunkSourceKind = validChunkKinds.includes(req.sourceKind ?? '')
    ? (req.sourceKind as string)
    : 'manual'

  const chunkRows = chunks.map((chunk, i) => ({
    document_id:  documentId,
    brand_id:     req.brandId,
    chunk_index:  chunk.index,
    content:      chunk.content,
    token_count:  chunk.tokenCount,
    embedding:    JSON.stringify(chunkEmbeddings[i]),
    source_kind:  chunkSourceKind,
    importance:   0.5,
  }))

  const { data: insertedChunks, error: chunksErr } = await db
    .from('knowledge_chunks')
    .insert(chunkRows)
    .select('id')

  if (chunksErr) throw new IngestError(`Error insertando chunks: ${chunksErr.message}`)

  const firstChunkId = insertedChunks?.[0]?.id ?? null

  // 6. Extraer grafo de conocimiento (LLM) — no crítico
  const graph = await extractGraph(content)

  // 7. Upsert entidades con embeddings
  const { created: entitiesCreated, updated: entitiesUpdated, idByName } =
    await upsertEntities(graph.entities, req.brandId, db, openai)

  // 8. Insertar relaciones
  const { created: relationsCreated, skipped: relationsSkipped } =
    await insertRelations(graph.relations, idByName, req.brandId, firstChunkId, db)

  // 9. Marcar como ingestado
  await db
    .from('knowledge_documents')
    .update({ status: 'ingested', updated_at: new Date().toISOString() })
    .eq('id', documentId)

  return {
    documentId,
    chunksCreated:    chunkRows.length,
    entitiesCreated,
    entitiesUpdated,
    relationsCreated,
    relationsSkipped,
    durationMs:       Date.now() - startedAt,
  }
}

// ─────────────────────────────────────────────────────────────────────
// Limpieza de texto
// ─────────────────────────────────────────────────────────────────────

export function cleanText(raw: string): string {
  return raw
    .replace(/```[\w]*\n([\s\S]*?)```/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ─────────────────────────────────────────────────────────────────────
// Fetch y extracción desde URL
// ─────────────────────────────────────────────────────────────────────

async function fetchAndExtractUrl(url: string): Promise<string> {
  let resp: Response
  try {
    resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; BrainBot/1.0)',
        'Accept':     'text/html,text/plain,*/*',
      },
      signal: AbortSignal.timeout(15_000),
    })
  } catch (err) {
    throw new IngestError(`No se pudo alcanzar la URL: ${err instanceof Error ? err.message : String(err)}`)
  }

  if (!resp.ok) throw new IngestError(`La URL devolvió HTTP ${resp.status}`)

  const contentType = resp.headers.get('content-type') ?? ''
  const rawBody = await resp.text()

  return cleanText(
    contentType.includes('text/html') ? extractTextFromHtml(rawBody) : rawBody
  )
}

function extractTextFromHtml(html: string): string {
  return html
    .replace(/<(script|style|nav|footer|header|aside|noscript)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/(p|div|section|article|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g,  '&')
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g,  "'")
    .replace(/&nbsp;/g, ' ')
}

// ─────────────────────────────────────────────────────────────────────
// Chunking semántico (markdown-aware con overlap)
// ─────────────────────────────────────────────────────────────────────

export function chunkMarkdown(text: string): Chunk[] {
  const sectionPattern = /(?=\n#{1,4} )/
  const rawSections = text.split(sectionPattern).filter(s => s.trim().length > 0)

  const chunks: Chunk[] = []
  let chunkIndex = 0
  let overlapBuffer = ''

  for (const section of rawSections) {
    const paragraphs = section
      .split(/\n\n+/)
      .map(p => p.trim())
      .filter(p => p.length > 0)

    let current = overlapBuffer
    let currentChars = overlapBuffer.length

    for (const para of paragraphs) {
      if (para.length > TARGET_CHARS) {
        if (current.length > OVERLAP_CHARS) {
          chunks.push(buildChunk(chunkIndex++, current.trim()))
          overlapBuffer = current.slice(-OVERLAP_CHARS)
          current = overlapBuffer
          currentChars = overlapBuffer.length
        }
        const sentenceChunks = splitBySentences(para, overlapBuffer)
        for (const sc of sentenceChunks) {
          chunks.push(buildChunk(chunkIndex++, sc.trim()))
        }
        overlapBuffer = para.slice(-OVERLAP_CHARS)
        current = overlapBuffer
        currentChars = overlapBuffer.length
        continue
      }

      if (currentChars + para.length > TARGET_CHARS && currentChars > OVERLAP_CHARS) {
        chunks.push(buildChunk(chunkIndex++, current.trim()))
        overlapBuffer = current.slice(-OVERLAP_CHARS)
        current = overlapBuffer + '\n\n' + para
        currentChars = current.length
      } else {
        current = current ? current + '\n\n' + para : para
        currentChars = current.length
      }
    }

    if (current.trim().length > OVERLAP_CHARS + 20) {
      chunks.push(buildChunk(chunkIndex++, current.trim()))
      overlapBuffer = current.slice(-OVERLAP_CHARS)
    }
  }

  return chunks.filter(c => c.content.length >= 100)
}

function splitBySentences(text: string, overlap: string): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+(?:\s|$)/g) ?? [text]
  const result: string[] = []
  let current = overlap

  for (const sentence of sentences) {
    if (current.length + sentence.length > TARGET_CHARS && current.length > OVERLAP_CHARS) {
      result.push(current.trim())
      current = current.slice(-OVERLAP_CHARS) + ' ' + sentence
    } else {
      current += ' ' + sentence
    }
  }

  if (current.trim().length > OVERLAP_CHARS + 20) result.push(current.trim())
  return result
}

function buildChunk(index: number, content: string): Chunk {
  return { index, content, tokenCount: Math.ceil(content.length / CHARS_PER_TOKEN) }
}

// ─────────────────────────────────────────────────────────────────────
// Embeddings en batch
// ─────────────────────────────────────────────────────────────────────

export async function embedBatch(client: OpenAI, texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return []

  const results: number[][] = []

  for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBED_BATCH_SIZE)
    const safeBatch = batch.map(t => t.length > 30_000 ? t.slice(0, 30_000) : t)

    const resp = await client.embeddings.create({
      model:           'text-embedding-3-small',
      input:           safeBatch,
      encoding_format: 'float',
    })

    results.push(...resp.data
      .sort((a, b) => a.index - b.index)
      .map(d => d.embedding)
    )
  }

  return results
}

// ─────────────────────────────────────────────────────────────────────
// Extracción de grafo: entidades + relaciones via LLM
// ─────────────────────────────────────────────────────────────────────

async function extractGraph(content: string): Promise<ExtractedGraph> {
  const groqKey   = Deno.env.get('GROQ_API_KEY')
  const openaiKey = Deno.env.get('OPENAI_API_KEY')

  if (!groqKey && !openaiKey) {
    console.warn('[ingest] Sin clave LLM — saltando extracción de grafo')
    return { entities: [], relations: [] }
  }

  const llm = groqKey
    ? new OpenAI({ apiKey: groqKey, baseURL: 'https://api.groq.com/openai/v1' })
    : new OpenAI({ apiKey: openaiKey })

  const model   = groqKey ? 'llama-3.3-70b-versatile' : 'gpt-4o-mini'
  const excerpt = content.length > 16_000 ? content.slice(0, 16_000) + '\n[...texto truncado]' : content

  try {
    const resp = await llm.chat.completions.create({
      model,
      messages:        [{ role: 'user', content: buildExtractionPrompt(excerpt) }],
      temperature:     0.1,
      max_tokens:      1200,
      response_format: groqKey ? undefined : { type: 'json_object' },
    })

    return parseExtractionResponse(resp.choices[0]?.message?.content ?? '')
  } catch (err) {
    console.warn('[ingest] Error en extracción de grafo:', err instanceof Error ? err.message : String(err))
    return { entities: [], relations: [] }
  }
}

function buildExtractionPrompt(text: string): string {
  return `Analiza el siguiente texto de negocios y extrae entidades relevantes y relaciones entre ellas.

TIPOS DE ENTIDADES:
- product: productos, SKUs, colecciones, servicios
- customer: clientes, segmentos de clientes, buyer personas
- decision: decisiones estratégicas, aprobaciones, acuerdos
- campaign: campañas de marketing, lanzamientos, promociones
- person: personas (colaboradores, proveedores, influencers)
- concept: conceptos de negocio, metodologías, principios de marca
- event: eventos, hitos, fechas clave
- metric: métricas, KPIs, objetivos numéricos

PREDICADOS recomendados (verbos en infinitivo_snake_case):
pertenece_a, genera, afectar_a, depender_de, recomendar, rechazar,
aprobar, lanzar, dirigirse_a, competir_con, reemplazar, incluir,
asociar_con, derivar_de, medir, impactar

REGLAS:
1. Solo extrae entidades que aparecen explícitamente en el texto
2. Los nombres deben ser exactos tal como aparecen
3. Máximo 10 entidades y 15 relaciones
4. Si no hay entidades claras, devuelve listas vacías
5. confidence entre 0.5 y 1.0

Responde ÚNICAMENTE con JSON válido, sin texto adicional:
{"entities":[{"kind":"tipo","name":"nombre exacto","description":"descripción en 1 oración"}],"relations":[{"source":"nombre_1","predicate":"verbo","target":"nombre_2","confidence":0.9}]}

TEXTO:
${text}`
}

function parseExtractionResponse(raw: string): ExtractedGraph {
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return { entities: [], relations: [] }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as { entities?: unknown[]; relations?: unknown[] }
    return {
      entities:  (Array.isArray(parsed.entities)  ? parsed.entities.filter(isValidEntity)   : []).slice(0, 10),
      relations: (Array.isArray(parsed.relations) ? parsed.relations.filter(isValidRelation) : []).slice(0, 15),
    }
  } catch {
    return { entities: [], relations: [] }
  }
}

function isValidEntity(e: unknown): e is Entity {
  if (!e || typeof e !== 'object') return false
  const obj = e as Record<string, unknown>
  const validKinds: EntityKind[] = ['product','customer','decision','campaign','person','concept','event','metric']
  return (
    typeof obj.kind === 'string' && validKinds.includes(obj.kind as EntityKind) &&
    typeof obj.name === 'string' && obj.name.trim().length > 0 &&
    typeof obj.description === 'string'
  )
}

function isValidRelation(r: unknown): r is Relation {
  if (!r || typeof r !== 'object') return false
  const obj = r as Record<string, unknown>
  return (
    typeof obj.source === 'string'    && obj.source.trim().length > 0 &&
    typeof obj.predicate === 'string' && obj.predicate.trim().length > 0 &&
    typeof obj.target === 'string'    && obj.target.trim().length > 0 &&
    typeof obj.confidence === 'number' && obj.confidence >= 0 && obj.confidence <= 1
  )
}

// ─────────────────────────────────────────────────────────────────────
// Upsert de entidades
// ─────────────────────────────────────────────────────────────────────

async function upsertEntities(
  entities: Entity[],
  brandId: string,
  db: SupabaseClient,
  openai: OpenAI,
): Promise<{ created: number; updated: number; idByName: Record<string, string> }> {
  if (entities.length === 0) return { created: 0, updated: 0, idByName: {} }

  const entityTexts  = entities.map(e => `${e.kind}: ${e.name}. ${e.description}`)
  const embeddings   = await embedBatch(openai, entityTexts)

  let created = 0
  let updated = 0
  const idByName: Record<string, string> = {}

  for (let i = 0; i < entities.length; i++) {
    const entity    = entities[i]
    const embedding = embeddings[i]
    const nameLower = entity.name.trim().toLowerCase()
    if (!nameLower) continue

    const { data: existing } = await db
      .from('knowledge_entities')
      .select('id, mention_count')
      .eq('brand_id', brandId)
      .ilike('name', entity.name.trim())
      .maybeSingle()

    if (existing) {
      await db
        .from('knowledge_entities')
        .update({
          mention_count: existing.mention_count + 1,
          description:   entity.description,
          embedding:     JSON.stringify(embedding),
          updated_at:    new Date().toISOString(),
        })
        .eq('id', existing.id)

      idByName[nameLower] = existing.id
      updated++
    } else {
      const { data: newEntity, error: insertErr } = await db
        .from('knowledge_entities')
        .insert({
          brand_id:    brandId,
          kind:        entity.kind,
          name:        entity.name.trim(),
          description: entity.description,
          embedding:   JSON.stringify(embedding),
        })
        .select('id')
        .single()

      if (insertErr) {
        if (insertErr.code === '23505') {
          const { data: race } = await db
            .from('knowledge_entities')
            .select('id')
            .eq('brand_id', brandId)
            .ilike('name', entity.name.trim())
            .maybeSingle()
          if (race) idByName[nameLower] = race.id
        } else {
          console.warn(`[ingest] Entidad no insertada (${entity.name}):`, insertErr.message)
        }
      } else if (newEntity) {
        idByName[nameLower] = newEntity.id
        created++
      }
    }
  }

  return { created, updated, idByName }
}

// ─────────────────────────────────────────────────────────────────────
// Inserción de relaciones
// ─────────────────────────────────────────────────────────────────────

async function insertRelations(
  relations: Relation[],
  idByName: Record<string, string>,
  brandId: string,
  sourceChunkId: string | null,
  db: SupabaseClient,
): Promise<{ created: number; skipped: number }> {
  let created = 0
  let skipped = 0

  for (const rel of relations) {
    const sourceId = idByName[rel.source.trim().toLowerCase()]
    const targetId = idByName[rel.target.trim().toLowerCase()]

    if (!sourceId || !targetId || sourceId === targetId) { skipped++; continue }

    const { error } = await db
      .from('knowledge_relations')
      .insert({
        brand_id:         brandId,
        source_entity_id: sourceId,
        target_entity_id: targetId,
        predicate:        rel.predicate.trim().toLowerCase(),
        confidence:       rel.confidence,
        source_chunk_id:  sourceChunkId,
      })

    if (!error) {
      created++
    } else if (error.code === '23505') {
      skipped++ // arista ya existe — no es error
    } else {
      console.warn(`[ingest] Relación no insertada (${rel.source}→${rel.target}):`, error.message)
      skipped++
    }
  }

  return { created, skipped }
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function buildOpenAIClient(): OpenAI {
  const key = Deno.env.get('OPENAI_API_KEY')
  if (!key) throw new IngestError('OPENAI_API_KEY no está configurado en los secrets de Supabase')
  return new OpenAI({ apiKey: key })
}

export class IngestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IngestError'
  }
}
