// Un turno de chat síncrono usuario↔agente, ahora con conversaciones separadas.
//
// Cada chat vive en una `conversation`. Si el caller no pasa conversation_id,
// se crea una nueva conversación y su título se deriva del primer mensaje.
// El historial se carga filtrado por conversación (contexto limpio por hilo).
import { adminDb } from './db.ts'
import { makeProvider, isRateOrSizeLimitError, type ChatMessage, type ChatCompleteResult } from './llm.ts'
import { loadTools, runTool, toToolDefinitions, capToolResultForContext } from './tools.ts'

const MAX_TOOL_ITERATIONS = 4
const HISTORY_WINDOW = 40

export interface ChatTurnResult {
  agent_id: string
  conversation_id: string
  user_message_id: string
  assistant_message_id: string | null
  iterations: number
  finished: boolean
  reason?: string
  error?: string
}

export async function runAgentChatTurn(
  agentId: string,
  userText: string,
  conversationId?: string | null,
): Promise<ChatTurnResult> {
  const db = adminDb()

  const { data: agent, error: e1 } = await db.from('agents').select('*').eq('id', agentId).maybeSingle()
  if (e1) throw new Error(e1.message)
  if (!agent) throw new Error('agent not found')
  if (agent.status === 'disabled') throw new Error('Agente deshabilitado')

  // ── Resolver la conversación: continuar la dada o crear una nueva ──
  let convId = conversationId ?? null
  let isNewConversation = false
  if (convId) {
    const { data: conv } = await db
      .from('conversations')
      .select('id, agent_id')
      .eq('id', convId)
      .maybeSingle()
    if (!conv || conv.agent_id !== agentId) convId = null // inválida → crear nueva
  }
  if (!convId) {
    const provisionalTitle = userText.trim().slice(0, 60) || 'Nueva conversación'
    const { data: created, error: convErr } = await db
      .from('conversations')
      .insert({
        agent_id: agentId,
        brand_id: agent.brand_id ?? null,
        title: provisionalTitle,
      })
      .select('id')
      .single()
    if (convErr) throw new Error(`No se pudo crear la conversación: ${convErr.message}`)
    convId = created.id
    isNewConversation = true
  }
  // A partir de aquí convId siempre es un string (conversación existente válida
  // o recién creada). Este guard narrowiza el tipo para TS y documenta el
  // invariante: nunca insertamos mensajes con conversation_id null.
  if (!convId) throw new Error('No se pudo resolver la conversación')

  // ── Persistir el mensaje del usuario ──
  const { data: userMsg, error: insErr } = await db
    .from('messages')
    .insert({
      agent_id: agentId,
      task_id: null,
      conversation_id: convId,
      role: 'user',
      content: userText,
      metadata: { source: 'chat' },
    })
    .select('id')
    .single()
  if (insErr) throw new Error(`No se pudo guardar tu mensaje: ${insErr.message}`)

  await db
    .from('agents')
    .update({ status: 'running', last_heartbeat_at: new Date().toISOString() })
    .eq('id', agentId)

  try {
    const allowedForChat = ((agent.allowed_tools ?? []) as string[]).filter((t) => t !== 'finish_task')
    const toolDescs = await loadTools(allowedForChat)
    const toolDefs = toToolDefinitions(toolDescs)

    // Historial SOLO de esta conversación (contexto limpio por hilo)
    const { data: history } = await db
      .from('messages')
      .select('id, role, content, tool_call_id, tool_calls, created_at')
      .eq('conversation_id', convId)
      .order('created_at', { ascending: false })
      .limit(HISTORY_WINDOW)
    const historyAsc = (history ?? []).slice().reverse()

    const messages: ChatMessage[] = []
    messages.push({ role: 'system', content: agent.system_prompt })
    for (const m of historyAsc) {
      messages.push({
        role: m.role,
        content: m.content,
        tool_call_id: m.tool_call_id ?? undefined,
        tool_calls: m.tool_calls ?? undefined,
      })
    }

    const provider = makeProvider(agent.provider ?? 'groq')
    const cfg = (agent.config ?? {}) as { temperature?: number; max_tokens?: number }

    let iterations = 0
    let finished = false
    let stopReason: string | undefined
    let lastAssistantId: string | null = null

    while (iterations < MAX_TOOL_ITERATIONS) {
      iterations++
      // 1) Insertar el mensaje del asistente VACÍO → habilita el "tipeo" en vivo
      const { data: ins } = await db
        .from('messages')
        .insert({
          agent_id: agentId,
          task_id: null,
          conversation_id: convId,
          role: 'assistant',
          content: '',
          metadata: { source: 'chat', streaming: true },
        })
        .select('id')
        .single()
      const assistantMsgId = ins?.id ?? null
      lastAssistantId = assistantMsgId

      // 2) Completar — en streaming si el proveedor lo soporta (Claude), con
      //    updates throttled del contenido para el efecto de escritura en vivo.
      const completeParams = {
        model: agent.model,
        messages,
        tools: toolDefs.length > 0 ? toolDefs : undefined,
        temperature: cfg.temperature ?? 0.4,
        max_tokens: cfg.max_tokens ?? 1500,
      }
      let result: ChatCompleteResult
      try {
        if (provider.completeStream && assistantMsgId) {
          let streamed = ''
          let lastFlush = 0
          result = await provider.completeStream(completeParams, {
            onText: (delta) => {
              streamed += delta
              const now = Date.now()
              if (now - lastFlush > 180) {
                lastFlush = now
                // best-effort: si un update intermedio falla, no rompe el turno
                db.from('messages').update({ content: streamed }).eq('id', assistantMsgId).then(() => {}, () => {})
              }
            },
          })
        } else {
          result = await provider.complete(completeParams)
        }
      } catch (e) {
        // Si NO es un límite de tokens, propaga (lo maneja index.ts como 500).
        if (!isRateOrSizeLimitError(e)) throw e
        // Degradación con gracia: el agente responde en el chat con un mensaje
        // claro en vez de reventar con un 500 opaco.
        const friendly =
          '⚠️ Esta consulta generó más datos de los que entran en el límite de tokens por minuto del proveedor actual. ' +
          'Acota el alcance (por ejemplo, menos productos u órdenes a la vez, o un filtro más específico) y vuelve a intentar.'
        if (assistantMsgId) {
          await db
            .from('messages')
            .update({ content: friendly, metadata: { source: 'chat', error: 'rate_or_size_limit' } })
            .eq('id', assistantMsgId)
        }
        stopReason = 'rate_or_size_limit'
        finished = true
        break
      }

      // 3) Finalizar el mensaje con contenido + tool_calls + metadata definitivos
      if (assistantMsgId) {
        await db
          .from('messages')
          .update({
            content: result.content,
            tool_calls: result.tool_calls.length > 0 ? result.tool_calls : null,
            metadata: { source: 'chat', usage: result.usage, finish_reason: result.finish_reason },
          })
          .eq('id', assistantMsgId)
      }

      messages.push({
        role: 'assistant',
        content: result.content,
        tool_calls: result.tool_calls.length > 0 ? result.tool_calls : undefined,
      })

      if (result.tool_calls.length === 0) {
        finished = true
        break
      }

      let didBlock = false
      for (const tc of result.tool_calls) {
        const isAllowed = allowedForChat.includes(tc.function.name)
        if (!isAllowed) {
          const ep = { ok: false, error: `Tool no disponible en chat: ${tc.function.name}` }
          messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(ep) })
          await db.from('messages').insert({
            agent_id: agentId, task_id: null, conversation_id: convId,
            role: 'tool', tool_call_id: tc.id, content: JSON.stringify(ep), metadata: { source: 'chat' },
          })
          continue
        }

        const startedAt = Date.now()
        const { data: tcRow } = await db
          .from('tool_calls')
          .insert({
            agent_id: agentId, task_id: null, message_id: ins?.id ?? null,
            tool_name: tc.function.name, args: safeParseJson(tc.function.arguments), status: 'running',
          })
          .select('id')
          .single()

        const toolRes = await runTool({ db, agentId, taskId: null, brandId: agent.brand_id ?? null }, tc)
        const durationMs = Date.now() - startedAt

        await db
          .from('tool_calls')
          .update({
            result: toolRes.data ?? null, error: toolRes.error ?? null,
            status: toolRes.ok ? 'success' : 'failed', duration_ms: durationMs,
            completed_at: new Date().toISOString(),
          })
          .eq('id', tcRow?.id ?? '')

        // Capamos lo que entra al CONTEXTO (el resultado completo ya quedó en
        // `tool_calls.result`). Esto evita que 50 productos/órdenes revienten el
        // límite de tokens del proveedor en la siguiente iteración.
        const tc2 = capToolResultForContext(toolRes)
        messages.push({ role: 'tool', tool_call_id: tc.id, content: tc2 })
        await db.from('messages').insert({
          agent_id: agentId, task_id: null, conversation_id: convId,
          role: 'tool', tool_call_id: tc.id, content: tc2, metadata: { source: 'chat' },
        })

        if (tc.function.name === 'request_approval' || tc.function.name === 'escalate_to_ceo') didBlock = true
      }

      if (didBlock) {
        finished = true
        break
      }
    }

    // Si es conversación nueva, mejoramos el título con un resumen del LLM
    // (corto, una frase). Best-effort: si falla, queda el título provisional.
    if (isNewConversation) {
      generateTitle(agent, userText, lastAssistantId, convId, db).catch(() => null)
    }

    return {
      agent_id: agentId,
      conversation_id: convId,
      user_message_id: userMsg.id,
      assistant_message_id: lastAssistantId,
      iterations,
      finished,
      reason: stopReason,
    }
  } finally {
    await db.from('agents').update({ status: 'idle' }).eq('id', agentId)
  }
}

// Genera un título corto y limpio para la conversación a partir del primer
// intercambio. Fire-and-forget — no bloquea la respuesta al usuario.
async function generateTitle(
  agent: { provider?: string; model: string },
  userText: string,
  _assistantId: string | null,
  convId: string,
  db: ReturnType<typeof adminDb>,
): Promise<void> {
  try {
    const provider = makeProvider(agent.provider ?? 'groq')
    const result = await provider.complete({
      model: agent.model,
      messages: [
        {
          role: 'user',
          content: `Resume en MÁXIMO 6 palabras, sin comillas ni punto final, el tema de este mensaje para usarlo como título de conversación: "${userText.slice(0, 200)}"`,
        },
      ],
      temperature: 0.3,
      max_tokens: 30,
    })
    const title = (result.content ?? '').trim().replace(/^["']|["']$/g, '').slice(0, 60)
    if (title) {
      await db.from('conversations').update({ title }).eq('id', convId)
    }
  } catch {
    // queda el título provisional
  }
}

function safeParseJson(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return { _raw: s }
  }
}
