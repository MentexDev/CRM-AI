// =====================================================================
// Edge Function: query-brain
// Consulta híbrida al brain: vector + FTS + importancia + grafo
// =====================================================================
import { createClient } from 'jsr:@supabase/supabase-js@^2'
import { runQueryPipeline, QueryError } from '../_shared/query.ts'
import { requireEngineKey } from '../_shared/auth.ts'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-engine-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405)

  // Auth máquina-a-máquina: exige X-Engine-Key (expone la inteligencia de marca con service_role).
  const denied = requireEngineKey(req)
  if (denied) return denied

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Body JSON inválido' }, 400)
  }

  const brandId = (body.brand_id as string | undefined)?.trim()
  const query   = (body.query   as string | undefined)?.trim()

  if (!brandId) return json({ error: 'Falta brand_id' }, 400)
  if (!query)   return json({ error: 'Falta query' }, 400)
  if (query.length < 3) return json({ error: 'La query debe tener al menos 3 caracteres' }, 400)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceKey) {
    return json({ error: 'Variables de entorno no configuradas' }, 500)
  }

  const db = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  try {
    const result = await runQueryPipeline(
      {
        brandId,
        query,
        limit:        body.limit        as number  | undefined,
        sourceKind:    body.source_kind    as string  | undefined,
        minScore:      body.min_score      as number  | undefined,
        minSimilarity: body.min_similarity as number  | undefined,
        maxPerDoc:     body.max_per_doc    as number  | undefined,
        includeGraph:  body.include_graph  as boolean | undefined,
      },
      db,
    )

    return json({
      ok:       true,
      query:    result.query,
      chunks:   result.chunks.map(c => ({
        id:             c.id,
        content:        c.content,
        document_title: c.documentTitle,
        source_kind:    c.sourceKind,
        importance:     c.importance,
        access_count:   c.accessCount,
        score:          c.score,
      })),
      entities: result.entities.map(e => ({
        id:          e.id,
        kind:        e.kind,
        name:        e.name,
        description: e.description,
        similarity:  e.similarity,
      })),
      stats: {
        chunks_found:   result.stats.chunksFound,
        entities_found: result.stats.entitiesFound,
        embed_ms:       result.stats.embedMs,
        search_ms:      result.stats.searchMs,
        total_ms:       result.stats.totalMs,
      },
    })
  } catch (err) {
    const isExpected = err instanceof QueryError
    const message    = err instanceof Error ? err.message : String(err)
    if (!isExpected) console.error('[query-brain] Error inesperado:', message)
    return json({ ok: false, error: message }, isExpected ? 422 : 500)
  }
})

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS, 'content-type': 'application/json; charset=utf-8' },
  })
}
