// =====================================================================
// Edge Function: brain-proxy
// PROXY seguro entre la UI y el cerebro de negocio (RAG).
//
// La UI llama aquí (autenticada con el JWT del login). Esta función verifica
// que haya un usuario válido y, según la acción:
//   - reenvía a las funciones m2m (`ingest-document`, `query-brain`) con la
//     ENGINE_API_KEY, que vive SOLO en los secrets de Supabase (nunca en el
//     navegador) — esas funciones son fail-closed (ver _shared/auth.ts);
//   - o lee directo las tablas del cerebro con service_role (bypass RLS) para
//     listar documentos y el panel de salud — solo lectura.
//
//   action: "ingest"        { brand_id, title, content|source_url, source_kind? } → ingest-document
//   action: "query"         { brand_id, query, limit?, include_graph? }           → query-brain
//   action: "list_documents"{ brand_id }                                          → knowledge_documents
//   action: "health"        { brand_id }                                          → brain_health_log + counts
//
// Secrets requeridos: ENGINE_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY,
//                     SUPABASE_SERVICE_ROLE_KEY.
// verify_jwt=false porque verificamos el usuario manualmente (deja pasar OPTIONS).
// =====================================================================
import { createClient } from 'jsr:@supabase/supabase-js@^2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const DOC_FIELDS =
  'id, title, source_kind, status, chunk_count, source_uri, created_at, updated_at'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!

  // 1) Verificar usuario autenticado (JWT del login que envía supabase-js)
  const authHeader = req.headers.get('Authorization') || ''
  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: { user }, error: authErr } = await authClient.auth.getUser()
  if (authErr || !user) return json({ error: 'No autenticado' }, 401)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Body JSON inválido' }, 400)
  }

  const action = (body.action as string | undefined)?.trim()
  const brandId = (body.brand_id as string | undefined)?.trim()
  if (!brandId) return json({ error: 'Falta brand_id' }, 400)

  try {
    // --- Acciones que reenvían a funciones m2m (requieren ENGINE_API_KEY) ---
    if (action === 'ingest' || action === 'query') {
      const engineKey = Deno.env.get('ENGINE_API_KEY')
      if (!engineKey) {
        return json({ error: 'ENGINE_API_KEY no está en los secrets de Supabase' }, 500)
      }
      const fnHeaders = {
        Authorization: `Bearer ${anonKey}`,
        apikey: anonKey,
        'Content-Type': 'application/json',
        'X-Engine-Key': engineKey,
      }

      if (action === 'ingest') {
        const title = (body.title as string | undefined)?.trim()
        const content = (body.content as string | undefined)?.trim()
        const sourceUrl = (body.source_url as string | undefined)?.trim()
        if (!title) return json({ error: 'Falta el título' }, 400)
        if (!content && !sourceUrl) {
          return json({ error: 'Falta el contenido o una URL' }, 400)
        }
        const payload: Record<string, unknown> = {
          brand_id: brandId,
          title,
          source_kind: (body.source_kind as string | undefined)?.trim() || 'manual',
        }
        if (content) payload.content = content
        if (sourceUrl) payload.source_url = sourceUrl
        if (body.agent_id) payload.agent_id = body.agent_id
        const r = await fetch(`${supabaseUrl}/functions/v1/ingest-document`, {
          method: 'POST',
          headers: fnHeaders,
          body: JSON.stringify(payload),
        })
        return passthrough(r)
      }

      // action === 'query'
      const query = (body.query as string | undefined)?.trim()
      if (!query || query.length < 3) {
        return json({ error: 'La búsqueda debe tener al menos 3 caracteres' }, 400)
      }
      const r = await fetch(`${supabaseUrl}/functions/v1/query-brain`, {
        method: 'POST',
        headers: fnHeaders,
        body: JSON.stringify({
          brand_id: brandId,
          query,
          limit: (body.limit as number | undefined) ?? 8,
          include_graph: body.include_graph ?? true,
        }),
      })
      return passthrough(r)
    }

    // --- Acciones de solo lectura (service_role, bypass RLS) ---
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!serviceKey) {
      return json({ error: 'SUPABASE_SERVICE_ROLE_KEY no está en los secrets' }, 500)
    }
    const db = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    if (action === 'list_documents') {
      const { data, error } = await db
        .from('knowledge_documents')
        .select(DOC_FIELDS)
        .eq('brand_id', brandId)
        .order('created_at', { ascending: false })
        .limit(200)
      if (error) return json({ error: error.message }, 500)
      return json({ ok: true, documents: data ?? [] })
    }

    if (action === 'health') {
      // Último parte del brain-doctor (es global, sin brand_id) + conteos por marca.
      const countByBrand = (table: string) =>
        db.from(table).select('id', { count: 'exact', head: true }).eq('brand_id', brandId)

      const [logRes, docsRes, chunksRes, entitiesRes] = await Promise.all([
        db.from('brain_health_log').select('*').order('created_at', { ascending: false }).limit(1),
        countByBrand('knowledge_documents'),
        countByBrand('knowledge_chunks'),
        countByBrand('knowledge_entities'),
      ])
      if (docsRes.error) return json({ error: docsRes.error.message }, 500)
      return json({
        ok: true,
        last_log: logRes.data?.[0] ?? null,
        counts: {
          documents: docsRes.count ?? 0,
          chunks: chunksRes.count ?? 0,
          entities: entitiesRes.count ?? 0,
        },
      })
    }

    return json(
      { error: "action debe ser 'ingest', 'query', 'list_documents' o 'health'" },
      400,
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[brain-proxy] Error:', message)
    return json({ ok: false, error: `Error en el cerebro: ${message}` }, 502)
  }
})

async function passthrough(r: Response): Promise<Response> {
  const text = await r.text()
  return new Response(text, {
    status: r.status,
    headers: { ...CORS, 'content-type': 'application/json; charset=utf-8' },
  })
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS, 'content-type': 'application/json; charset=utf-8' },
  })
}
