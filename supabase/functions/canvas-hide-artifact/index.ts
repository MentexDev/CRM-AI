// Edge Function · canvas-hide-artifact
//
// Oculta (o restaura) un artefacto del canvas marcando el mensaje con
// metadata.canvas_hidden. El cliente NO puede UPDATE messages (no hay policy de UPDATE,
// por diseño), así que lo hacemos con service_role — pero SOLO tras validar, con la
// sesión del caller (RLS messages_read_by_access), que ese usuario puede ver el mensaje.
// Es un "soft-hide": no borra el mensaje (el agente conserva su contexto), solo lo saca
// del canvas. Persistente (sobrevive recargas) y reversible.
import { createClient } from 'jsr:@supabase/supabase-js@^2'
import { adminDb } from '../_shared/db.ts'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Max-Age': '86400',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS })

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return json({ error: 'Falta Authorization' }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: userData, error: userErr } = await callerClient.auth.getUser(token)
  if (userErr || !userData?.user) return json({ error: 'Token inválido' }, 401)

  let body: { message_id?: string; hidden?: boolean }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Body JSON inválido' }, 400)
  }
  const messageId = body.message_id?.trim()
  if (!messageId) return json({ error: 'Falta message_id' }, 400)
  const hidden = body.hidden !== false // default true

  // Autorización por marca/hilo: si el caller puede LEER el mensaje con SU sesión (RLS),
  // tiene acceso. Si no, no devuelve fila → 403. (Misma barrera que el resto del runtime.)
  const { data: msg } = await callerClient.from('messages').select('id, metadata').eq('id', messageId).maybeSingle()
  if (!msg) return json({ error: 'No tienes acceso a ese mensaje' }, 403)

  const admin = adminDb()
  const newMeta = { ...((msg.metadata ?? {}) as Record<string, unknown>), canvas_hidden: hidden }
  const { error: upErr } = await admin.from('messages').update({ metadata: newMeta }).eq('id', messageId)
  if (upErr) return json({ error: upErr.message }, 500)

  return json({ ok: true, message_id: messageId, hidden })
})

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json; charset=utf-8' },
  })
}
