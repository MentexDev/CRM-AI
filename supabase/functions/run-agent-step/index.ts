// Edge Function · run-agent-step
//
// Ejecuta un solo "tick" de un agente. Útil para:
//   - Disparar manualmente desde el dashboard / curl para debug
//   - Disparar manualmente desde el front (botón "Ejecutar tick")
//   - Ser invocada por la función `heartbeat` para cada agente activo
//
// Auth: requiere header `Authorization: Bearer <JWT>`. Acepta tanto el JWT
// del usuario logueado en el front como el service_role key.
//
// Body acepta `{ agent_id: <uuid> }` o `{ agent_slug: <slug> }`.
import { runAgentStep } from '../_shared/agent_step.ts'
import { adminDb } from '../_shared/db.ts'

// Cuando el browser invoca la function (vía supabase.functions.invoke),
// hace un preflight OPTIONS antes del POST. Si no respondemos con estos
// headers el preflight falla y el POST nunca se manda.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Max-Age': '86400',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS })
  }

  let body: { agent_id?: string; agent_slug?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Body JSON inválido' }, 400)
  }

  let agentId = body.agent_id
  if (!agentId && body.agent_slug) {
    const { data, error } = await adminDb()
      .from('agents')
      .select('id')
      .eq('slug', body.agent_slug)
      .maybeSingle()
    if (error) return json({ error: error.message }, 500)
    if (!data) return json({ error: `Agent no encontrado: ${body.agent_slug}` }, 404)
    agentId = data.id
  }

  if (!agentId) return json({ error: 'agent_id o agent_slug requerido' }, 400)

  try {
    const result = await runAgentStep(agentId)
    return json(result)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return json({ error: msg }, 500)
  }
})

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json; charset=utf-8' },
  })
}
