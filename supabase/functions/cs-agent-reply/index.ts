// Edge Function · cs-agent-reply
//
// El agente vendedor responde una conversación de Atención al Cliente (WhatsApp) y mueve el lead por el
// pipeline según avanza la venta. Lo invoca cs-webhook (m2m) tras un mensaje ENTRANTE, solo si el canal
// tiene auto_reply ON + agente asignado y la conversación NO está pausada (agent_active).
//
// Loop: arma el historial de la conversación → LLM (modelo/proveedor del agente) con 2 herramientas
// [buscar_productos (catálogo Shopify de la marca), mover_etapa (cambia stage del lead)] → la RESPUESTA
// final de texto se envía al cliente por la Evolution API y se guarda como mensaje saliente (sender 'agent').
//
// Auth: verify_jwt=false; gateado por X-Engine-Key (requireEngineKey). Nunca expone llaves al cliente.
import { adminDb } from '../_shared/db.ts'
import { requireEngineKey } from '../_shared/auth.ts'
import { makeProvider } from '../_shared/llm.ts'
import { shopifyGraphQL } from '../_shared/shopify.ts'

const EVO_URL = (Deno.env.get('EVOLUTION_API_URL') ?? '').replace(/\/$/, '')
const EVO_KEY = Deno.env.get('EVOLUTION_API_KEY') ?? ''
const digits = (s: string) => String(s ?? '').replace(/\D/g, '')

// Envía un texto por WhatsApp vía Evolution. Devuelve el id del mensaje (para dedup del eco en cs-webhook).
async function evoSend(instance: string, number: string, text: string): Promise<string | null> {
  try {
    const r = await fetch(`${EVO_URL}/message/sendText/${instance}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: EVO_KEY },
      body: JSON.stringify({ number, text }),
    })
    const json = await r.json().catch(() => ({}))
    return json?.key?.id ?? null
  } catch (e) {
    console.error('[cs-agent-reply] evoSend', e instanceof Error ? e.message : e)
    return null
  }
}

// Busca productos en el catálogo Shopify de la marca (precios + tallas disponibles).
async function buscarProductos(query: string) {
  try {
    const data = await shopifyGraphQL<{ products: { edges: { node: Record<string, unknown> }[] } }>(
      `query($q: String!) {
        products(first: 6, query: $q) {
          edges { node {
            title
            priceRangeV2 { minVariantPrice { amount currencyCode } }
            variants(first: 12) { edges { node { title availableForSale } } }
          } }
        }
      }`,
      { q: query },
    )
    const productos = (data?.products?.edges ?? []).map((e) => {
      const n = e.node as Record<string, any>
      const tallas = (n.variants?.edges ?? []).filter((v: any) => v.node.availableForSale).map((v: any) => v.node.title)
      return {
        producto: n.title,
        precio: n.priceRangeV2?.minVariantPrice?.amount ?? null,
        moneda: n.priceRangeV2?.minVariantPrice?.currencyCode ?? null,
        tallas_disponibles: tallas,
      }
    })
    return { ok: true, productos }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

Deno.serve(async (req) => {
  const denied = requireEngineKey(req)
  if (denied) return denied

  let conversation_id: string | undefined
  try {
    conversation_id = (await req.json())?.conversation_id
  } catch {
    return new Response('ok')
  }
  if (!conversation_id) return new Response('ok')

  const db = adminDb()
  try {
    // 1. Conversación + guardas (abierta, no pausada)
    const { data: conv } = await db
      .from('cs_conversations')
      .select('id, brand_id, contact_id, channel_id, agent_active, status')
      .eq('id', conversation_id)
      .maybeSingle()
    if (!conv || conv.status !== 'open' || conv.agent_active === false || !conv.channel_id) return new Response('ok')

    const { data: channel } = await db
      .from('cs_channels')
      .select('id, brand_id, session_id, agent_id, auto_reply')
      .eq('id', conv.channel_id)
      .maybeSingle()
    if (!channel || !channel.auto_reply || !channel.agent_id) return new Response('ok')

    const { data: agent } = await db
      .from('agents')
      .select('name, system_prompt, model, provider, config')
      .eq('id', channel.agent_id)
      .maybeSingle()
    if (!agent) return new Response('ok')

    const { data: contact } = await db.from('cs_contacts').select('id, name, phone').eq('id', conv.contact_id).maybeSingle()
    if (!contact?.phone) return new Response('ok')

    const { data: lead } = await db.from('cs_leads').select('id, stage_id').eq('brand_id', conv.brand_id).eq('contact_id', conv.contact_id).maybeSingle()
    const { data: stages } = await db.from('cs_stages').select('id, name, position').eq('brand_id', conv.brand_id).order('position', { ascending: true })
    const stageNames = (stages ?? []).map((s) => s.name)
    const currentStage = stages?.find((s) => s.id === lead?.stage_id)?.name ?? '(sin etapa)'

    const { data: hist } = await db
      .from('cs_messages')
      .select('direction, content, type, created_at')
      .eq('conversation_id', conv.id)
      .order('created_at', { ascending: false })
      .limit(16)
    const history = (hist ?? []).reverse()

    // 2. Mensajes para el LLM (system del agente + contexto de venta + historial)
    const sys = `${agent.system_prompt}

— CONTEXTO DE VENTA · WhatsApp (Atención al Cliente) —
Hablas por WhatsApp con ${contact.name || 'un cliente'}. NO es texto formal: sé CERCANO, breve y comercial, como un buen vendedor por chat. Responde en español, 1-3 frases, con emojis moderados. Tu objetivo es asesorar y CERRAR la venta.
Etapa actual del cliente en el pipeline: "${currentStage}". Etapas disponibles (en orden): ${stageNames.join(' → ')}.
- Usa buscar_productos para consultar el catálogo REAL (precios, tallas) ANTES de afirmar precio o disponibilidad. No inventes referencias ni precios.
- Usa mover_etapa cuando la conversación avance (interés real → "${stageNames[1] ?? 'En negociación'}"; acuerdan/agendan → "${stageNames[2] ?? 'Agendado'}"; confirma compra → "${stageNames[3] ?? 'Cerrado'}"; se cae → "${stageNames[stageNames.length - 1] ?? 'Perdido'}"). Usa EXACTAMENTE uno de los nombres disponibles.
- Tu RESPUESTA FINAL (texto) es el mensaje que se le envía al cliente por WhatsApp. NO pongas notas internas, prefijos ni comillas.`

    const messages: Record<string, unknown>[] = [{ role: 'system', content: sys }]
    for (const m of history) {
      const txt = m.content || (m.type !== 'text' ? `[${m.type}]` : '')
      if (!txt) continue
      messages.push({ role: m.direction === 'inbound' ? 'user' : 'assistant', content: txt })
    }

    // 3. Herramientas + loop
    const tools = [
      {
        type: 'function',
        function: {
          name: 'buscar_productos',
          description: 'Busca productos en el catálogo (Shopify) de la marca: precios y tallas disponibles. Úsalo antes de dar precios o confirmar disponibilidad.',
          parameters: { type: 'object', required: ['query'], properties: { query: { type: 'string', description: 'Lo que busca el cliente, p.ej. "jean tiro alto azul" o "pantalón negro talla 30".' } } },
        },
      },
      {
        type: 'function',
        function: {
          name: 'mover_etapa',
          description: 'Mueve al cliente a otra etapa del pipeline de ventas según avanza la conversación.',
          parameters: { type: 'object', required: ['etapa'], properties: { etapa: { type: 'string', enum: stageNames, description: 'Nombre EXACTO de la etapa destino.' } } },
        },
      },
    ]

    const provider = makeProvider(agent.provider || 'openrouter')
    const cfg = (agent.config ?? {}) as Record<string, number>
    let reply: string | null = null
    for (let i = 0; i < 4 && !reply; i++) {
      const res = await provider.complete({
        model: agent.model,
        messages: messages as never,
        tools: tools as never,
        temperature: cfg.temperature ?? 0.6,
        max_tokens: cfg.max_tokens ?? 700,
      })
      if (res.tool_calls && res.tool_calls.length) {
        messages.push({ role: 'assistant', content: res.content ?? '', tool_calls: res.tool_calls })
        for (const tc of res.tool_calls) {
          let args: Record<string, unknown> = {}
          try { args = JSON.parse(tc.function.arguments || '{}') } catch { /* args vacíos */ }
          let result: unknown
          if (tc.function.name === 'buscar_productos') {
            result = await buscarProductos(String(args.query ?? ''))
          } else if (tc.function.name === 'mover_etapa') {
            const target = (stages ?? []).find((s) => s.name.toLowerCase() === String(args.etapa ?? '').toLowerCase())
            if (target && lead) {
              await db.from('cs_leads').update({ stage_id: target.id, updated_at: new Date().toISOString() }).eq('id', lead.id)
              result = { ok: true, etapa: target.name }
            } else {
              result = { ok: false, error: 'etapa no encontrada o el cliente no tiene lead' }
            }
          } else {
            result = { ok: false, error: 'herramienta desconocida' }
          }
          messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) })
        }
        continue
      }
      reply = (res.content || '').trim() || null
    }

    // 4. Enviar la respuesta por WhatsApp + guardarla (sender_type 'agent' → no pausa el auto)
    if (reply) {
      const waId = await evoSend(channel.session_id || `cs_${channel.id}`, digits(contact.phone), reply)
      await db.from('cs_messages').insert({
        brand_id: conv.brand_id,
        conversation_id: conv.id,
        direction: 'outbound',
        sender_type: 'agent',
        type: 'text',
        content: reply,
        wa_message_id: waId,
        status: 'sent',
      })
    }
    return new Response('ok')
  } catch (e) {
    console.error('[cs-agent-reply]', e instanceof Error ? e.message : e)
    return new Response('ok')
  }
})
