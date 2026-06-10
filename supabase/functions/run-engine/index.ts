// =====================================================================
// Edge Function: run-engine
// PROXY seguro entre la UI y el motor agéntico (Railway).
//
// La UI llama aquí (autenticada con el JWT del login). Esta función verifica
// que haya un usuario válido y reenvía al motor con la ENGINE_API_KEY, que vive
// SOLO en los secrets de Supabase — nunca llega al navegador.
//
//   action: "start"  { directive }  → POST  {ENGINE_URL}/runs
//   action: "status" { run_id }     → GET   {ENGINE_URL}/runs/{run_id}
//
// Secrets requeridos:  ENGINE_API_KEY  (y opcional ENGINE_URL).
// verify_jwt=false porque verificamos el usuario manualmente (deja pasar OPTIONS).
// =====================================================================
import { createClient } from 'jsr:@supabase/supabase-js@^2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const ENGINE_URL = (
  Deno.env.get('ENGINE_URL') || 'https://crm-ai-production-b0f5.up.railway.app'
).replace(/\/$/, '')

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  // 1) Verificar usuario autenticado (JWT del login que envía supabase-js)
  const authHeader = req.headers.get('Authorization') || ''
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: { user }, error: authErr } = await authClient.auth.getUser()
  if (authErr || !user) return json({ error: 'No autenticado' }, 401)

  // 2) Key del motor (server-side, nunca en el navegador)
  const engineKey = Deno.env.get('ENGINE_API_KEY')
  if (!engineKey) return json({ error: 'ENGINE_API_KEY no está en los secrets de Supabase' }, 500)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Body JSON inválido' }, 400)
  }

  const action = (body.action as string | undefined)?.trim()
  const headers = { 'Content-Type': 'application/json', 'X-Engine-Key': engineKey }

  try {
    if (action === 'list') {
      // Historial: no va al motor, sino a la BD (Edge Function agent-run).
      const r = await fetch(`${supabaseUrl}/functions/v1/agent-run`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${anonKey}`, apikey: anonKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list', limit: (body.limit as number | undefined) ?? 10 }),
      })
      return passthrough(r)
    }

    if (action === 'start') {
      const directive = (body.directive as string | undefined)?.trim()
      if (!directive) return json({ error: 'Falta directive' }, 400)
      const r = await fetch(`${ENGINE_URL}/runs`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ directive }),
      })
      return passthrough(r)
    }

    if (action === 'status') {
      const runId = (body.run_id as string | undefined)?.trim()
      if (!runId) return json({ error: 'Falta run_id' }, 400)
      const r = await fetch(`${ENGINE_URL}/runs/${runId}`, { headers })
      return passthrough(r)
    }

    return json({ error: "action debe ser 'start' o 'status'" }, 400)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[run-engine] Error:', message)
    return json({ ok: false, error: `No se pudo contactar el motor: ${message}` }, 502)
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
