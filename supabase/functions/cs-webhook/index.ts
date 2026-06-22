// Edge Function · cs-webhook
//
// Recibe los webhooks de la Evolution API (WhatsApp). Por cada mensaje ENTRANTE: encuentra el canal
// (por session_id = nombre de la instancia), AUTO-crea el contacto (por marca+número), su conversación
// y su lead (1ª etapa), y guarda el mensaje. El trigger de BD actualiza "último mensaje" y Supabase
// Realtime lo muestra en el inbox en vivo. También actualiza el estado del canal (connection.update).
//
// Auth: verify_jwt=false (Evolution no manda JWT). Verificamos ?key=CS_WEBHOOK_SECRET (fail-closed),
// secreto que SOLO conoce cs-evolution al configurar la instancia (nunca se expone al cliente).
import { adminDb } from '../_shared/db.ts'

const WEBHOOK_SECRET = Deno.env.get('CS_WEBHOOK_SECRET') ?? ''

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  // Verificación del secreto (fail-closed). Acepta header x-cs-secret (preferido) o ?key (fallback).
  const key = new URL(req.url).searchParams.get('key') ?? ''
  const headerKey = req.headers.get('x-cs-secret') ?? ''
  if (!WEBHOOK_SECRET || (key !== WEBHOOK_SECRET && headerKey !== WEBHOOK_SECRET)) return new Response('Forbidden', { status: 403 })

  let body: any
  try { body = await req.json() } catch { return new Response('ok') }

  const event = String(body?.event ?? '').toLowerCase()
  const instance = body?.instance ?? body?.instanceName ?? null
  const data = body?.data ?? {}
  if (!instance) return new Response('ok')

  const db = adminDb()
  const { data: channel } = await db.from('cs_channels').select('id, brand_id').eq('session_id', instance).maybeSingle()
  if (!channel) return new Response('ok') // instancia desconocida → ignorar

  try {
    if (event === 'connection.update') {
      const state = data?.state ?? data?.connection ?? ''
      const status = state === 'open' ? 'connected' : state === 'connecting' ? 'connecting' : 'disconnected'
      await db.from('cs_channels').update({ status, updated_at: new Date().toISOString() }).eq('id', channel.id)
      return new Response('ok')
    }

    if (event === 'messages.upsert') {
      // El payload varía por versión: data puede ser el mensaje, {message:{...}}, o {messages:[...]}.
      const msg = data?.key ? data : data?.message?.key ? data.message : Array.isArray(data?.messages) ? data.messages[0] : data
      const k = msg?.key ?? {}
      const jid = String(k.remoteJid ?? '')
      if (!jid || jid.endsWith('@g.us')) return new Response('ok') // ignorar grupos por ahora
      const phone = jid.split('@')[0].replace(/\D/g, '')
      if (!phone) return new Response('ok')
      // fromMe = lo enviamos nosotros (eco de cs-evolution, lo descarta el dedup) o el operador respondió
      // DESDE el celular (lo guardamos como outbound para que la bandeja compartida no lo pierda).
      const direction = k.fromMe ? 'outbound' : 'inbound'
      const sender_type = k.fromMe ? 'operator' : 'contact'

      const m = msg?.message ?? {}
      let type = 'text'
      let content = m.conversation ?? m.extendedTextMessage?.text ?? ''
      if (m.imageMessage) { type = 'image'; content = m.imageMessage.caption ?? '' }
      else if (m.audioMessage) { type = 'audio'; content = '' }
      else if (m.videoMessage) { type = 'video'; content = m.videoMessage.caption ?? '' }
      else if (m.documentMessage) { type = 'document'; content = m.documentMessage.fileName ?? '' }
      const waId = k.id ?? null
      const pushName = msg?.pushName ?? null

      // Contacto IDEMPOTENTE (ante carrera del unique(brand_id,phone) NO se pierde el mensaje).
      let { data: contact } = await db.from('cs_contacts').select('id, name').eq('brand_id', channel.brand_id).eq('phone', phone).maybeSingle()
      if (!contact) {
        const ins = await db.from('cs_contacts').insert({ brand_id: channel.brand_id, channel_id: channel.id, name: pushName, phone }).select('id, name').maybeSingle()
        if (ins.data) {
          contact = ins.data
          const { data: st } = await db.from('cs_stages').select('id').eq('brand_id', channel.brand_id).order('position', { ascending: true }).limit(1)
          await db.from('cs_leads').insert({ brand_id: channel.brand_id, contact_id: contact.id, stage_id: st?.[0]?.id ?? null })
        } else {
          // Carrera: otro webhook ya lo creó → reseleccionar (el INSERT falló por unique, sin throw).
          contact = (await db.from('cs_contacts').select('id, name').eq('brand_id', channel.brand_id).eq('phone', phone).maybeSingle()).data
        }
      } else if (!contact.name && pushName && !k.fromMe) {
        await db.from('cs_contacts').update({ name: pushName }).eq('id', contact.id)
      }
      if (!contact) return new Response('ok')

      // Conversación abierta (reusar/crear). Si la existente es MANUAL (channel_id null), asignarle el canal
      // para que el operador pueda responder por WhatsApp.
      let { data: conv } = await db.from('cs_conversations').select('id, channel_id').eq('brand_id', channel.brand_id).eq('contact_id', contact.id).eq('status', 'open').maybeSingle()
      if (!conv) {
        const ins = await db.from('cs_conversations').insert({ brand_id: channel.brand_id, contact_id: contact.id, channel_id: channel.id }).select('id').maybeSingle()
        conv = ins.data ?? (await db.from('cs_conversations').select('id').eq('brand_id', channel.brand_id).eq('contact_id', contact.id).eq('status', 'open').maybeSingle()).data
      } else if (!conv.channel_id) {
        await db.from('cs_conversations').update({ channel_id: channel.id }).eq('id', conv.id)
      }
      if (!conv) return new Response('ok')

      // Dedup por wa_message_id (descarta nuestro propio eco outbound y reentregas del webhook).
      if (waId) {
        const { data: dup } = await db.from('cs_messages').select('id').eq('conversation_id', conv.id).eq('wa_message_id', waId).maybeSingle()
        if (dup) return new Response('ok')
      }
      await db.from('cs_messages').insert({ brand_id: channel.brand_id, conversation_id: conv.id, direction, sender_type, type, content, wa_message_id: waId })
      return new Response('ok')
    }

    return new Response('ok')
  } catch (e) {
    console.error('[cs-webhook]', e instanceof Error ? e.message : e)
    return new Response('ok') // nunca devolver error a Evolution (reintentaría en bucle)
  }
})
