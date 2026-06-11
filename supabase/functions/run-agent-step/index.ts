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
import { createClient } from 'jsr:@supabase/supabase-js@^2'
import { runAgentStep } from '../_shared/agent_step.ts'
import { adminDb } from '../_shared/db.ts'

// Cuando el browser invoca la function (vía supabase.functions.invoke),
// hace un preflight OPTIONS antes del POST. Si no respondemos con estos
// headers el preflight falla y el POST nunca se manda.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-engine-key',
  'Access-Control-Max-Age': '86400',
}

// Auth: acepta (a) la clave interna del motor (X-Engine-Key, para curl/heartbeat
// externo) o (b) un usuario autenticado con rol 'junta'. Antes ejecutaba ticks
// (que gastan LLM y disparan acciones) sin verificar identidad ni rol.
async function authorize(req: Request): Promise<Response | null> {
  const engineKey = req.headers.get('X-Engine-Key')
  const expectedKey = Deno.env.get('ENGINE_API_KEY')
  if (expectedKey && engineKey && engineKey === expectedKey) return null

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return json({ error: 'No autorizado' }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const caller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: u, error: uErr } = await caller.auth.getUser(token)
  if (uErr || !u?.user) return json({ error: 'Token inválido' }, 401)

  const { data: profile } = await adminDb()
    .from('profiles')
    .select('role')
    .eq('id', u.user.id)
    .maybeSingle()
  if (!profile || profile.role !== 'junta') {
    return json({ error: 'Sólo la Junta puede ejecutar ticks de agente' }, 403)
  }
  return null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS })
  }

  const denied = await authorize(req)
  if (denied) return denied

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
