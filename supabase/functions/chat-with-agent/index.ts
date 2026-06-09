// Edge Function · chat-with-agent
//
// Chat síncrono usuario↔agente. El usuario escribe un mensaje y el agente
// responde inmediatamente (vs el flujo normal de tareas + cron).
//
// Body: { agent_id?: string, agent_slug?: string, content: string }
// Auth: requiere JWT del caller (cualquier usuario autenticado vale; las
// RLS sobre `messages` ya filtran qué puede ver cada quien).
import { createClient } from 'jsr:@supabase/supabase-js@^2'
import { runAgentChatTurn } from '../_shared/agent_chat.ts'
import { adminDb } from '../_shared/db.ts'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Max-Age': '86400',
}

const MAX_CONTENT_LEN = 4000

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS })
  }

  // Verifica que el caller esté autenticado
  const authHeader = req.headers.get('Authorization') ?? ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) return json({ error: 'Falta Authorization' }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: userData, error: userErr } = await callerClient.auth.getUser(token)
  if (userErr || !userData?.user) return json({ error: 'Token inválido' }, 401)

  let body: { agent_id?: string; agent_slug?: string; content?: string; conversation_id?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Body JSON inválido' }, 400)
  }

  const content = (body.content ?? '').toString().trim()
  if (!content) return json({ error: 'Falta content' }, 400)
  if (content.length > MAX_CONTENT_LEN) {
    return json({ error: `Mensaje muy largo (>${MAX_CONTENT_LEN} chars)` }, 400)
  }

  let agentId = body.agent_id
  if (!agentId && body.agent_slug) {
    const { data, error } = await adminDb()
      .from('agents')
      .select('id')
      .eq('slug', body.agent_slug)
      .maybeSingle()
    if (error) return json({ error: error.message }, 500)
    if (!data) return json({ error: `Agente no encontrado: ${body.agent_slug}` }, 404)
    agentId = data.id
  }
  if (!agentId) return json({ error: 'agent_id o agent_slug requerido' }, 400)

  try {
    const result = await runAgentChatTurn(agentId, content, body.conversation_id ?? null)
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
