// Edge Function · cs-evolution
//
// PROXY entre el frontend del módulo Atención al Cliente y la Evolution API (WhatsApp por QR).
// El frontend NUNCA ve la API key de Evolution: llama aquí con su JWT (RLS valida acceso al canal),
// y esta función habla con Evolution usando los secretos del servidor. También configura el webhook
// de cada instancia hacia cs-webbook (con CS_WEBHOOK_SECRET, nunca expuesto al cliente).
//
// Body: { action: 'connect'|'state'|'send'|'disconnect', channel_id, ... }
// Secrets requeridos: EVOLUTION_API_URL, EVOLUTION_API_KEY, CS_WEBHOOK_SECRET (+ SUPABASE_URL).
import { createClient } from 'jsr:@supabase/supabase-js@^2'
import { adminDb } from '../_shared/db.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const EVO_URL = (Deno.env.get('EVOLUTION_API_URL') ?? '').replace(/\/$/, '')
const EVO_KEY = Deno.env.get('EVOLUTION_API_KEY') ?? ''
const WEBHOOK_SECRET = Deno.env.get('CS_WEBHOOK_SECRET') ?? ''

function instanceName(channelId: string) { return `cs_${channelId}` }
function digits(phone: string) { return (phone ?? '').replace(/\D/g, '') }

async function evo(path: string, method = 'GET', body?: unknown): Promise<{ status: number; json: any }> {
  const r = await fetch(`${EVO_URL}${path}`, {
    method,
    headers: { apikey: EVO_KEY, 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  let json: any = null
  try { json = await r.json() } catch { json = null }
  return { status: r.status, json }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  if (!EVO_URL || !EVO_KEY) {
    return json({ error: 'WhatsApp no configurado todavía. Falta montar el servidor de Evolution API y cargar sus secretos.' }, 503)
  }

  // Auth: el caller debe poder LEER el canal con su sesión (RLS por marca). Esa es la barrera de acceso.
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return json({ error: 'Falta Authorization' }, 401)
  const caller = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: u } = await caller.auth.getUser(token)
  if (!u?.user) return json({ error: 'Token inválido' }, 401)

  let body: any
  try { body = await req.json() } catch { return json({ error: 'Body inválido' }, 400) }
  const { action, channel_id } = body ?? {}
  if (!channel_id) return json({ error: 'channel_id requerido' }, 400)

  const { data: ch } = await caller.from('cs_channels').select('id, brand_id, name').eq('id', channel_id).maybeSingle()
  if (!ch) return json({ error: 'No tienes acceso a este canal' }, 403)

  const db = adminDb()
  const inst = instanceName(channel_id)

  try {
    if (action === 'connect') {
      // El secreto del webhook va en HEADER (x-cs-secret) además del ?key de fallback → menos riesgo de
      // filtración por logs de URL. cs-webhook acepta cualquiera de los dos.
      const webhookUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/cs-webhook?key=${WEBHOOK_SECRET}`
      const wh = { url: webhookUrl, byEvents: false, base64: true, headers: { 'x-cs-secret': WEBHOOK_SECRET }, events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE'] }
      // 1) Crear la instancia. "Ya existe" es benigno; cualquier OTRO error 4xx/5xx se propaga.
      const created = await evo('/instance/create', 'POST', { instanceName: inst, integration: 'WHATSAPP-BAILEYS', qrcode: true, webhook: wh })
      if (created.status >= 400 && !/exist|already|in use|duplicate/i.test(JSON.stringify(created.json ?? ''))) {
        return json({ error: `Evolution (create): ${JSON.stringify(created.json ?? '').slice(0, 200)}` }, 502)
      }
      // 2) Asegurar el webhook (algunas versiones lo ignoran en create) — best-effort.
      await evo(`/webhook/set/${inst}`, 'POST', { webhook: { enabled: true, ...wh } }).catch(() => {})
      // 3) Obtener el QR. Solo marcamos connecting + session_id cuando SÍ hay un QR válido (no antes).
      const c = await evo(`/instance/connect/${inst}`)
      const qr = c.json?.base64 ?? c.json?.qrcode?.base64 ?? c.json?.qrcode ?? null
      if (!qr) return json({ error: `No pude generar el QR: ${JSON.stringify(c.json ?? '').slice(0, 160)}` }, 502)
      await db.from('cs_channels').update({ status: 'connecting', session_id: inst, updated_at: new Date().toISOString() }).eq('id', channel_id)
      return json({ ok: true, qr })
    }

    if (action === 'state') {
      const s = await evo(`/instance/connectionState/${inst}`)
      const state = s.json?.instance?.state ?? s.json?.state ?? 'close'
      const status = state === 'open' ? 'connected' : state === 'connecting' ? 'connecting' : 'disconnected'
      await db.from('cs_channels').update({ status, updated_at: new Date().toISOString() }).eq('id', channel_id)
      return json({ ok: true, state, status })
    }

    if (action === 'send') {
      const { text, conversation_id } = body
      if (!conversation_id || !text) return json({ error: 'conversation_id y text requeridos' }, 400)
      // Validar que la conversación es de la MISMA marca y (si tiene canal) del MISMO canal, y derivar el
      // DESTINO del contacto de la conversación — NO de un 'to' del body. Esto evita (incluso con
      // service_role) escribir en hilos de otra marca o enviar WhatsApp a un número arbitrario.
      const { data: conv } = await db.from('cs_conversations').select('id, brand_id, channel_id, cs_contacts!inner(phone)').eq('id', conversation_id).maybeSingle()
      if (!conv || conv.brand_id !== ch.brand_id) return json({ error: 'La conversación no pertenece a este canal' }, 403)
      if (conv.channel_id && conv.channel_id !== channel_id) return json({ error: 'La conversación es de otro canal' }, 403)
      const number = digits(conv.cs_contacts?.phone ?? '')
      if (!number) return json({ error: 'El contacto no tiene número' }, 400)
      const r = await evo(`/message/sendText/${inst}`, 'POST', { number, text })
      if (r.status >= 400) return json({ error: `Evolution: ${JSON.stringify(r.json).slice(0, 200)}` }, 502)
      const waId = r.json?.key?.id ?? null
      await db.from('cs_messages').insert({ brand_id: ch.brand_id, conversation_id, direction: 'outbound', sender_type: 'operator', sender_id: u.user.id, type: 'text', content: text, wa_message_id: waId, status: 'sent' })
      // Handoff humano: si el operador responde a mano, se pausa la auto-respuesta del agente en esta conversación.
      await db.from('cs_conversations').update({ agent_active: false }).eq('id', conversation_id)
      return json({ ok: true, wa_message_id: waId })
    }

    if (action === 'disconnect') {
      await evo(`/instance/logout/${inst}`, 'DELETE').catch(() => {})
      await db.from('cs_channels').update({ status: 'disconnected', updated_at: new Date().toISOString() }).eq('id', channel_id)
      return json({ ok: true })
    }

    return json({ error: 'action inválida' }, 400)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { ...CORS, 'content-type': 'application/json; charset=utf-8' } })
}
