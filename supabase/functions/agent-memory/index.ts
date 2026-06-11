// =====================================================================
// Edge Function: agent-memory
// Memoria persistente POR AGENTE (la pieza de "estado" tipo Letta, pero
// sobre Supabase: sin Docker, sin server nuevo, sin vendor nuevo).
//
//   action: "remember" → embebe el contenido y lo guarda en agent_memory
//   action: "recall"   → búsqueda semántica de los recuerdos del agente
//
// Reusa embedText (OpenAI text-embedding-3-small) y el RPC search_agent_memory.
// =====================================================================
import { createClient } from 'jsr:@supabase/supabase-js@^2'
import { requireEngineKey } from '../_shared/auth.ts'

// Embedding inline (OpenAI text-embedding-3-small · 1536 dims) — mantiene la
// función autocontenida, sin depender de _shared al desplegar.
async function embedText(text: string): Promise<number[]> {
  const key = Deno.env.get('OPENAI_API_KEY')
  if (!key) throw new Error('OPENAI_API_KEY no está definido para embeddings')
  const resp = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: text }),
  })
  if (!resp.ok) throw new Error(`OpenAI embeddings ${resp.status}: ${await resp.text()}`)
  const data = await resp.json()
  return data.data[0].embedding as number[]
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-engine-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  // Auth máquina-a-máquina: exige X-Engine-Key (lee/escribe memoria de agentes con service_role).
  const denied = requireEngineKey(req)
  if (denied) return denied

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Body JSON inválido' }, 400)
  }

  const action = (body.action as string | undefined)?.trim()
  const agentId = (body.agent_id as string | undefined)?.trim()
  if (!agentId) return json({ error: 'Falta agent_id' }, 400)
  if (action !== 'remember' && action !== 'recall') {
    return json({ error: "action debe ser 'remember' o 'recall'" }, 400)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceKey) {
    return json({ error: 'Variables de entorno no configuradas' }, 500)
  }
  const db = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  try {
    if (action === 'remember') {
      // kind admitidos por el check de la tabla: note | decision | learning | reminder
      const ALLOWED = ['note', 'decision', 'learning', 'reminder']
      const rawKind = (body.kind as string | undefined)?.trim() || 'note'
      const kind = ALLOWED.includes(rawKind) ? rawKind : 'note'
      const content = (body.content as string | undefined)?.trim()
      if (!content) return json({ error: 'Falta content' }, 400)

      const embedding = await embedText(content)
      const { data, error } = await db
        .from('agent_memory')
        .insert({
          agent_id: agentId,
          brand_id: (body.brand_id as string | undefined)?.trim() ?? null,
          kind,
          content,
          embedding: JSON.stringify(embedding),
        })
        .select('id')
        .single()
      if (error) return json({ ok: false, error: error.message }, 422)
      return json({ ok: true, action, memory_id: data.id })
    }

    // action === 'recall'
    const query = (body.query as string | undefined)?.trim()
    if (!query) return json({ error: 'Falta query' }, 400)
    const limit = (body.limit as number | undefined) ?? 5

    const vec = await embedText(query)
    const { data, error } = await db.rpc('search_agent_memory', {
      p_agent_id: agentId,
      p_embedding: JSON.stringify(vec),
      p_limit: limit,
    })
    if (error) return json({ ok: false, error: error.message }, 422)

    return json({
      ok: true,
      action,
      matches: (data ?? []).map((m: Record<string, unknown>) => ({
        kind: m.kind,
        content: m.content,
        created_at: m.created_at,
        similarity: m.similarity,
      })),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[agent-memory] Error:', message)
    return json({ ok: false, error: message }, 500)
  }
})

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS, 'content-type': 'application/json; charset=utf-8' },
  })
}
