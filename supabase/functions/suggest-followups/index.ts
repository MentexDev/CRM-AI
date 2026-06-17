// Edge Function · suggest-followups
//
// Genera 3 sugerencias de SEGUIMIENTO cortas y contextuales según cómo va la
// conversación (no las fijas por rol). Las pinta el composer del chat como
// "respuestas rápidas". Best-effort: si algo falla, devuelve [] y el front cae a
// las sugerencias estáticas.
import { createClient } from 'jsr:@supabase/supabase-js@^2'
import { adminDb } from '../_shared/db.ts'
import { makeProvider, type ChatMessage } from '../_shared/llm.ts'

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

  let body: { agent_id?: string; agent_slug?: string; conversation_id?: string }
  try {
    body = await req.json()
  } catch {
    return json({ suggestions: [] })
  }
  const conversationId = body.conversation_id
  if (!conversationId) return json({ suggestions: [] })

  const db = adminDb()
  let agentId = body.agent_id
  if (!agentId && body.agent_slug) {
    const { data } = await db.from('agents').select('id').eq('slug', body.agent_slug).maybeSingle()
    agentId = data?.id
  }
  if (!agentId) return json({ suggestions: [] })

  // Autorización por marca: el caller debe poder LEER el agente con SU sesión (RLS).
  const { data: allowed } = await callerClient.from('agents').select('id').eq('id', agentId).maybeSingle()
  if (!allowed) return json({ error: 'Sin acceso a este agente' }, 403)

  const { data: agent } = await db.from('agents').select('provider, model').eq('id', agentId).maybeSingle()
  if (!agent) return json({ suggestions: [] })

  // Últimos mensajes de texto del hilo (sin tools ni vacíos).
  const { data: history } = await db
    .from('messages')
    .select('role, content')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(10)
  const asc = (history ?? [])
    .slice()
    .reverse()
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
  if (asc.length === 0) return json({ suggestions: [] })

  const transcript = asc
    .map((m) => `${m.role === 'user' ? 'Usuario' : 'Agente'}: ${String(m.content).slice(0, 400)}`)
    .join('\n')

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        'Eres un asistente que propone 3 SEGUIMIENTOS cortos que el USUARIO podría querer pedir A CONTINUACIÓN, ' +
        'según el punto en que va la conversación. Deben ser ESPECÍFICOS a lo último que pasó (no genéricos), ' +
        'accionables, máximo 6 palabras cada uno, en español, como orden o pregunta corta. ' +
        'Devuelve SOLO un array JSON de exactamente 3 strings. Nada más.',
    },
    { role: 'user', content: `Conversación reciente:\n${transcript}\n\nDevuelve el array JSON con 3 sugerencias.` },
  ]

  try {
    // Modelo FIJO rápido y directo para esta tarea auxiliar (no el del agente): los modelos
    // de razonamiento como kimi-k2.5 gastan el presupuesto "pensando" y devuelven content
    // vacío en una petición corta. groq/llama responde el array de una. Si falla → [].
    const provider = makeProvider('groq')
    const result = await provider.complete({ model: 'llama-3.3-70b-versatile', messages, temperature: 0.5, max_tokens: 200 })
    return json({ suggestions: parseSuggestions(result.content ?? '') })
  } catch {
    return json({ suggestions: [] }) // best-effort: el front cae a las estáticas
  }
})

// Extrae el primer array JSON del texto del modelo y lo normaliza a ≤4 strings cortos.
function parseSuggestions(text: string): string[] {
  const m = (text ?? '').match(/\[[\s\S]*\]/)
  if (!m) return []
  try {
    const arr = JSON.parse(m[0])
    if (!Array.isArray(arr)) return []
    return arr
      .map((s) => String(s).trim().replace(/^["'\-\s]+|["'\s]+$/g, ''))
      .filter(Boolean)
      .slice(0, 4)
  } catch {
    return []
  }
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json; charset=utf-8' },
  })
}
