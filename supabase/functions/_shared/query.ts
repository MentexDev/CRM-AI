// =====================================================================
// Brain · Pipeline de Consulta (query_brain)
// Query → Embedding → Búsqueda híbrida → Enriquecimiento → Respuesta
// =====================================================================
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@^2'
import OpenAI from 'npm:openai@^4'

// ─────────────────────────────────────────────────────────────────────
// Tipos públicos
// ─────────────────────────────────────────────────────────────────────

export interface QueryRequest {
  brandId: string
  query: string
  limit?: number         // default 8, max 20
  sourceKind?: string    // filtrar por tipo: manual | distillation | obsidian | conversation
  minScore?: number      // umbral mínimo del score final (default 0.15)
  minSimilarity?: number // piso de similitud vectorial en la BD (default 0.12)
  maxPerDoc?: number     // diversidad: máx chunks por documento (default 2)
  includeGraph?: boolean // incluir entidades del grafo (default true)
}

export interface QueryResult {
  query: string
  chunks: ChunkResult[]
  entities: EntityResult[]
  stats: QueryStats
}

export interface ChunkResult {
  id: string
  content: string
  documentId: string
  documentTitle: string
  sourceKind: string
  importance: number
  accessCount: number
  score: number
}

export interface EntityResult {
  id: string
  kind: string
  name: string
  description: string
  similarity: number
}

export interface QueryStats {
  chunksFound: number
  entitiesFound: number
  embedMs: number
  searchMs: number
  totalMs: number
}

// ─────────────────────────────────────────────────────────────────────
// Constantes
// ─────────────────────────────────────────────────────────────────────

const DEFAULT_LIMIT          = 8
const MAX_LIMIT              = 20
const DEFAULT_MIN_SCORE      = 0.15  // ajustado al score normalizado (FTS 0..1)
const DEFAULT_MIN_SIMILARITY = 0.12  // piso de similitud vectorial (corta ruido)
const DEFAULT_MAX_PER_DOC    = 2     // diversidad: evita inundación de un solo doc
const ENTITY_LIMIT           = 5

// ─────────────────────────────────────────────────────────────────────
// Pipeline principal
// ─────────────────────────────────────────────────────────────────────

export async function runQueryPipeline(
  req: QueryRequest,
  db: SupabaseClient,
): Promise<QueryResult> {
  const startedAt = Date.now()

  const limit         = Math.min(req.limit ?? DEFAULT_LIMIT, MAX_LIMIT)
  const minScore      = req.minScore      ?? DEFAULT_MIN_SCORE
  const minSimilarity = req.minSimilarity ?? DEFAULT_MIN_SIMILARITY
  const maxPerDoc     = req.maxPerDoc     ?? DEFAULT_MAX_PER_DOC
  const includeGraph  = req.includeGraph  ?? true

  // ── 1. Embeber la query ───────────────────────────────────────────
  const embedStart = Date.now()
  const openai = buildOpenAIClient()
  const queryEmbedding = await embedQuery(openai, req.query)
  const embedMs = Date.now() - embedStart

  // ── 2. Búsqueda híbrida + entidades en paralelo ───────────────────
  const searchStart = Date.now()

  const [chunksRaw, entitiesRaw] = await Promise.all([
    searchChunks(db, req.brandId, queryEmbedding, req.query, limit, req.sourceKind, minSimilarity, maxPerDoc),
    includeGraph
      ? searchEntities(db, req.brandId, queryEmbedding, ENTITY_LIMIT)
      : Promise.resolve([]),
  ])

  const searchMs = Date.now() - searchStart

  // ── 3. Filtrar por min_score ──────────────────────────────────────
  const filteredChunks = chunksRaw.filter(c => c.score >= minScore)

  // ── 4. Enriquecer chunks con título del documento ─────────────────
  const enrichedChunks = await enrichWithDocumentTitles(db, filteredChunks)

  // ── 5. Actualizar access_count (fire-and-forget) ──────────────────
  if (filteredChunks.length > 0) {
    const ids = filteredChunks.map(c => c.id)
    // PostgrestBuilder es thenable pero no tiene .catch() nativo → wrappear en Promise
    Promise.resolve(db.rpc('increment_chunk_access', { p_ids: ids })).catch(() => null)
  }

  return {
    query: req.query,
    chunks: enrichedChunks,
    entities: entitiesRaw,
    stats: {
      chunksFound:   enrichedChunks.length,
      entitiesFound: entitiesRaw.length,
      embedMs,
      searchMs,
      totalMs: Date.now() - startedAt,
    },
  }
}

// ─────────────────────────────────────────────────────────────────────
// Búsqueda híbrida de chunks
// ─────────────────────────────────────────────────────────────────────

interface RawChunk {
  id: string
  document_id: string
  content: string
  source_kind: string
  importance: number
  access_count: number
  score: number
}

async function searchChunks(
  db: SupabaseClient,
  brandId: string,
  embedding: number[],
  queryFts: string,
  limit: number,
  sourceKind?: string,
  minSimilarity = DEFAULT_MIN_SIMILARITY,
  maxPerDoc = DEFAULT_MAX_PER_DOC,
): Promise<RawChunk[]> {
  const { data, error } = await db.rpc('search_knowledge_chunks', {
    p_brand_id:       brandId,
    p_embedding:      JSON.stringify(embedding),
    p_query_fts:      queryFts,
    p_limit:          limit,
    p_source_kind:    sourceKind ?? null,
    p_min_similarity: minSimilarity,
    p_max_per_doc:    maxPerDoc,
  })

  if (error) throw new QueryError(`Error en búsqueda de chunks: ${error.message}`)
  return (data ?? []) as RawChunk[]
}

// ─────────────────────────────────────────────────────────────────────
// Búsqueda semántica de entidades del grafo
// ─────────────────────────────────────────────────────────────────────

async function searchEntities(
  db: SupabaseClient,
  brandId: string,
  embedding: number[],
  limit: number,
): Promise<EntityResult[]> {
  const { data, error } = await db.rpc('search_knowledge_entities', {
    p_brand_id:  brandId,
    p_embedding: JSON.stringify(embedding),
    p_limit:     limit,
  })

  if (error) {
    // La búsqueda de entidades no es crítica — loguear y continuar
    console.warn('[query] Error en búsqueda de entidades:', error.message)
    return []
  }

  return ((data ?? []) as Array<{
    id: string; kind: string; name: string; description: string; similarity: number
  }>).filter(e => e.similarity >= 0.5) // solo entidades realmente relevantes
}

// ─────────────────────────────────────────────────────────────────────
// Enriquecer chunks con título del documento padre
// ─────────────────────────────────────────────────────────────────────

async function enrichWithDocumentTitles(
  db: SupabaseClient,
  chunks: RawChunk[],
): Promise<ChunkResult[]> {
  if (chunks.length === 0) return []

  // Una sola query para todos los document_ids únicos
  const docIds = [...new Set(chunks.map(c => c.document_id))]

  const { data: docs } = await db
    .from('knowledge_documents')
    .select('id, title')
    .in('id', docIds)

  const titleById: Record<string, string> = {}
  for (const doc of docs ?? []) {
    titleById[doc.id] = doc.title
  }

  return chunks.map(c => ({
    id:            c.id,
    content:       c.content,
    documentId:    c.document_id,
    documentTitle: titleById[c.document_id] ?? 'Sin título',
    sourceKind:    c.source_kind,
    importance:    c.importance,
    accessCount:   c.access_count,
    score:         Math.round(c.score * 1000) / 1000,
  }))
}

// ─────────────────────────────────────────────────────────────────────
// Embedding de la query
// ─────────────────────────────────────────────────────────────────────

async function embedQuery(client: OpenAI, text: string): Promise<number[]> {
  const safe = text.length > 8000 ? text.slice(0, 8000) : text
  const resp = await client.embeddings.create({
    model:           'text-embedding-3-small',
    input:           safe,
    encoding_format: 'float',
  })
  return resp.data[0].embedding
}

// ─────────────────────────────────────────────────────────────────────
// Formateo para agentes (payload LLM-ready)
// ─────────────────────────────────────────────────────────────────────

export function formatForAgent(result: QueryResult): Record<string, unknown> {
  if (result.chunks.length === 0) {
    return {
      query:  result.query,
      found:  false,
      note:   'No se encontró información relevante en el brain para esta consulta.',
      stats:  result.stats,
    }
  }

  return {
    query:  result.query,
    found:  true,
    chunks: result.chunks.map(c => ({
      content:  c.content,
      source:   c.documentTitle,
      kind:     c.sourceKind,
      score:    c.score,
    })),
    entities: result.entities.length > 0
      ? result.entities.map(e => ({
          name:        e.name,
          kind:        e.kind,
          description: e.description,
        }))
      : undefined,
    note: `${result.chunks.length} fragmento${result.chunks.length > 1 ? 's' : ''} relevante${result.chunks.length > 1 ? 's' : ''} encontrado${result.chunks.length > 1 ? 's' : ''} en ${result.stats.totalMs}ms.`,
    stats: result.stats,
  }
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function buildOpenAIClient(): OpenAI {
  const key = Deno.env.get('OPENAI_API_KEY')
  if (!key) throw new QueryError('OPENAI_API_KEY no está configurado')
  return new OpenAI({ apiKey: key })
}

export class QueryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'QueryError'
  }
}
