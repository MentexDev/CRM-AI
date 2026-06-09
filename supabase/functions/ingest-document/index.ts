// =====================================================================
// Edge Function: ingest-document
// Entrypoint HTTP — delega toda la lógica a _shared/ingest.ts
// =====================================================================
import { createClient } from 'jsr:@supabase/supabase-js@^2'
import { runIngestPipeline, IngestError } from '../_shared/ingest.ts'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405)

  // ── Parsear y validar el body ─────────────────────────────────────
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Body JSON inválido' }, 400)
  }

  const brandId   = (body.brand_id   as string | undefined)?.trim()
  const title     = (body.title      as string | undefined)?.trim()
  const content   = (body.content    as string | undefined)
  const sourceUrl = (body.source_url as string | undefined)?.trim()

  if (!brandId)               return json({ error: 'Falta brand_id' }, 400)
  if (!title)                 return json({ error: 'Falta title' }, 400)
  if (!content && !sourceUrl) return json({ error: 'Falta content o source_url' }, 400)

  // ── Cliente Supabase con service role (bypass RLS) ─────────────────
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceKey) {
    return json({ error: 'Variables de entorno de Supabase no configuradas' }, 500)
  }

  const db = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // ── Ejecutar el pipeline ──────────────────────────────────────────
  try {
    const result = await runIngestPipeline(
      {
        brandId,
        title,
        content,
        sourceUrl,
        sourceKind: (body.source_kind as string | undefined) ?? 'manual',
        sourceUri:  body.source_uri  as string | undefined,
        agentId:    body.agent_id    as string | undefined,
        metadata:   body.metadata    as Record<string, unknown> | undefined,
      },
      db,
    )

    return json({
      ok:                true,
      document_id:       result.documentId,
      chunks_created:    result.chunksCreated,
      entities_created:  result.entitiesCreated,
      entities_updated:  result.entitiesUpdated,
      relations_created: result.relationsCreated,
      relations_skipped: result.relationsSkipped,
      duration_ms:       result.durationMs,
    })
  } catch (err) {
    const isExpected = err instanceof IngestError
    const message    = err instanceof Error ? err.message : String(err)
    if (!isExpected) console.error('[ingest-document] Error inesperado:', message)
    return json({ ok: false, error: message }, isExpected ? 422 : 500)
  }
})

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS, 'content-type': 'application/json; charset=utf-8' },
  })
}
