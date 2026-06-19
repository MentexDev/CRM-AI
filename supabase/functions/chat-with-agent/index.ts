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
// Cuando el mensaje viene como "documento adjunto" (texto largo convertido a archivo en el chat),
// permitimos mucho más texto: es un documento que el agente debe leer, no un mensaje suelto.
const ATTACHMENT_MAX_LEN = 100_000

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

  let body: { agent_id?: string; agent_slug?: string; content?: string; conversation_id?: string; edit_context?: string; force_tool?: string; attachments?: { name?: string; chars?: number }[]; note_chars?: number }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Body JSON inválido' }, 400)
  }

  // Adjuntos opcionales (clip / "convertir texto a archivo"): cuando vienen, el contenido es un
  // documento → se permite un tope mucho mayor y se guarda metadata para pintar los chips.
  const attachments = Array.isArray(body.attachments)
    ? body.attachments
        .filter((a) => a && typeof a.name === 'string')
        .slice(0, 12)
        .map((a) => ({ name: (a.name as string).slice(0, 160), chars: Math.max(0, Number(a.chars) || 0) }))
    : []

  const content = (body.content ?? '').toString().trim()
  if (!content) return json({ error: 'Falta content' }, 400)
  const maxLen = attachments.length ? ATTACHMENT_MAX_LEN : MAX_CONTENT_LEN
  if (content.length > maxLen) {
    return json({ error: `Mensaje muy largo (>${maxLen} chars)` }, 400)
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

  // Autorización: el caller debe poder LEER el agente con SU sesión (RLS
  // agents_read_by_access, acotada por marca con has_brand_access). Bloquea que
  // un usuario dispare turnos / inyecte mensajes en agentes o hilos de una marca
  // a la que no pertenece (aislamiento multi-tenant). El turno corre con
  // service_role, así que ESTE chequeo es la única barrera de acceso por marca.
  const { data: allowedAgent } = await callerClient
    .from('agents')
    .select('id')
    .eq('id', agentId)
    .maybeSingle()
  if (!allowedAgent) return json({ error: 'No tienes acceso a este agente' }, 403)

  // Contexto de edición opcional (selector visual de HTML): el frontend manda el HTML
  // completo + el elemento señalado. Se inyecta SOLO en este turno (no se persiste); cap
  // defensivo de tamaño para no inflar el request al modelo.
  const EDIT_CTX_MAX = 300_000
  const editContext = typeof body.edit_context === 'string' ? body.edit_context.slice(0, EDIT_CTX_MAX) : undefined
  const forceTool = typeof body.force_tool === 'string' ? body.force_tool : undefined
  const triggerMeta: Record<string, unknown> = {}
  if (editContext) {
    triggerMeta.source = 'html_edit'
    triggerMeta.editContext = editContext
  }
  // forceFirstTool va SIN source → suppressClarify queda false y ask_questions sigue disponible.
  if (forceTool) triggerMeta.forceFirstTool = forceTool
  // Metadata de los adjuntos (chips) + note_chars (longitud de la nota para que la burbuja separe
  // la nota de los documentos). Se persiste en messages.metadata.
  if (attachments.length) {
    triggerMeta.attachments = attachments
    const nc = Number(body.note_chars)
    triggerMeta.note_chars = Number.isFinite(nc) ? Math.max(0, Math.min(nc, content.length)) : 0
  }

  try {
    const result = await runAgentChatTurn(agentId, content, body.conversation_id ?? null, userData.user.id, triggerMeta)
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
