// Un turno de chat síncrono usuario↔agente, ahora con conversaciones separadas.
//
// Cada chat vive en una `conversation`. Si el caller no pasa conversation_id,
// se crea una nueva conversación y su título se deriva del primer mensaje.
// El historial se carga filtrado por conversación (contexto limpio por hilo).
import { adminDb } from './db.ts'
import { makeProvider, isRateOrSizeLimitError, type ChatMessage, type ChatCompleteResult } from './llm.ts'
import { loadTools, runTool, toToolDefinitions, capToolResultForContext, capToolContentString, dailyBudgetExceeded, dropOrphanToolMessages } from './tools.ts'

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

// Guía que se anexa al system prompt SOLO en chat (usuario presente): empuja a pedir
// aclaraciones ante pedidos abiertos en vez de adivinar. La decisión la toma el modelo.
const CHAT_GUIDANCE =
  'Estás en un CHAT en vivo con el usuario. Si su pedido es ABIERTO o AMBIGUO —sobre todo ' +
  'el primer mensaje de una conversación nueva— NO adivines ni entregues de una: primero ' +
  'llama `ask_questions` con 2-5 preguntas clave (mezcla los tipos text, single y multi) para ' +
  'precisar el requerimiento. Las respuestas del usuario llegarán como su siguiente mensaje y ' +
  'ahí continúas. Si el pedido ya es claro o tienes contexto suficiente, NO preguntes: procede.'

export async function runAgentChatTurn(
  agentId: string,
  userText: string,
  conversationId?: string | null,
  callerId: string | null = null,
  // Metadata extra para el mensaje disparador. P.ej. el auto-resume de aprobaciones pasa
  // { source: 'approval_resume' } para que el front lo pinte como nota de sistema y NO como
  // una burbuja del usuario (la nota la generó la Junta en el panel, no el usuario del chat).
  triggerMeta: Record<string, unknown> = {},
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
    if (conv) {
      if (conv.agent_id !== agentId) convId = null // existe pero de otro agente → nueva
    } else {
      // No existe: el cliente la pre-creó con este id para navegar AL INSTANTE
      // (y ver el streaming en vivo). La creamos CON ese id para que los mensajes
      // caigan en el chat correcto. Si falla (id inválido/colisión), caemos al
      // fallback de generar un id en el servidor.
      const provisionalTitle = userText.trim().slice(0, 60) || 'Nueva conversación'
      const { error: cErr } = await db.from('conversations').insert({
        id: convId,
        agent_id: agentId,
        brand_id: agent.brand_id ?? null,
        title: provisionalTitle,
        created_by: callerId,
      })
      if (cErr) convId = null
      else isNewConversation = true
    }
  }
  if (!convId) {
    const provisionalTitle = userText.trim().slice(0, 60) || 'Nueva conversación'
    const { data: created, error: convErr } = await db
      .from('conversations')
      .insert({
        agent_id: agentId,
        brand_id: agent.brand_id ?? null,
        title: provisionalTitle,
        created_by: callerId,
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
      metadata: { source: 'chat', ...triggerMeta },
    })
    .select('id')
    .single()
  if (insErr) throw new Error(`No se pudo guardar tu mensaje: ${insErr.message}`)

  // F5 tope de costo (fail-CLOSED real): consultamos el gasto del día y, si la RPC
  // FALLA, cortamos igual (no proceder a ciegas). Si supera el presupuesto, también.
  const dailyBudget = ((agent.config ?? {}) as { daily_token_budget?: number }).daily_token_budget ?? 3_000_000
  const { data: spentRaw, error: budgetErr } = await db.rpc('agent_tokens_today', { p_agent_id: agentId })
  if (budgetErr || dailyBudgetExceeded(spentRaw, agent.config as { daily_token_budget?: number })) {
    const warn = budgetErr
      ? '⚠️ No pude verificar mi presupuesto de tokens (error de control). Reintenta en un momento.'
      : `⚠️ Alcancé mi presupuesto de tokens de hoy (${Number(spentRaw).toLocaleString()}/${dailyBudget.toLocaleString()}). Reanudo mañana, o súbeme el límite en mi configuración.`
    const { data: ins } = await db
      .from('messages')
      .insert({ agent_id: agentId, task_id: null, conversation_id: convId, role: 'assistant', content: warn, metadata: { source: 'chat', error: budgetErr ? 'budget_check_failed' : 'token_budget_exceeded' } })
      .select('id')
      .single()
    return { agent_id: agentId, conversation_id: convId, user_message_id: userMsg.id, assistant_message_id: ins?.id ?? null, iterations: 0, finished: true, reason: budgetErr ? 'budget_check_failed' : 'token_budget_exceeded' }
  }

  await db
    .from('agents')
    .update({ status: 'running', last_heartbeat_at: new Date().toISOString() })
    .eq('id', agentId)

  try {
    // Historial SOLO de esta conversación (contexto limpio por hilo)
    const { data: history } = await db
      .from('messages')
      .select('id, role, content, tool_call_id, tool_calls, created_at')
      .eq('conversation_id', convId)
      .order('created_at', { ascending: false })
      .limit(HISTORY_WINDOW)
    const historyAsc = (history ?? []).slice().reverse()

    // Saneamos el historial antes de reenviarlo: si la ventana (HISTORY_WINDOW) corta a mitad
    // de un turno (hilos largos, p.ej. el de reportes reusado), un 'tool' puede quedar sin su
    // 'assistant' con tool_calls → el proveedor devuelve 400. dropOrphanToolMessages los quita.
    const cleanHistory = dropOrphanToolMessages(historyAsc)

    // ¿Suprimir las preguntas aclaratorias en ESTE turno? Sí cuando:
    //  (a) el turno NO lo originó el usuario (resume de aprobación, reporte programado…):
    //      no hay nadie para responder un formulario; el agente debe EJECUTAR la orden; y
    //  (b) el turno anterior del asistente YA preguntó (ahora llegan las respuestas):
    //      debe PROCEDER, no re-preguntar (corta el bucle pregunta→responde→pregunta).
    const lastAssistant = [...cleanHistory]
      .reverse()
      .find((m) => m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length)
    const lastAssistantAsked = !!(
      lastAssistant?.tool_calls as { function?: { name?: string } }[] | undefined
    )?.some((tc) => tc?.function?.name === 'ask_questions')
    const suppressClarify = Boolean(triggerMeta?.source) || lastAssistantAsked

    // finish_task nunca está en chat. ask_questions se OFRECE solo si no está suprimido
    // (chat originado por el usuario y sin haber preguntado en el turno previo).
    const baseTools = ((agent.allowed_tools ?? []) as string[]).filter((t) => t !== 'finish_task')
    const allowedForChat = suppressClarify ? baseTools : [...new Set([...baseTools, 'ask_questions'])]
    const toolDescs = await loadTools(allowedForChat)
    const toolDefs = toToolDefinitions(toolDescs)

    const messages: ChatMessage[] = []
    messages.push({
      role: 'system',
      content: suppressClarify ? agent.system_prompt : `${agent.system_prompt}\n\n${CHAT_GUIDANCE}`,
    })
    for (const m of cleanHistory) {
      messages.push({
        role: m.role,
        // El historial guarda los resultados de tool en JSON COMPLETO (lo lee la
        // UI). Al recargarlos al contexto del LLM los volvemos a acotar para no
        // re-inflar el request (mismo motivo que el cap de los frescos).
        content: m.role === 'tool' && typeof m.content === 'string'
          ? capToolContentString(m.content)
          : m.content,
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
      // Si el agente preguntó (ask_questions) en este turno, ejecutamos SOLO esa llamada y
      // POSPONEMOS las hermanas: no enviar/mutar nada (send_email, shopify…) antes de que
      // el usuario aclare. Si emitió varias ask_questions, solo la primera se procesa.
      const askIdx = result.tool_calls.findIndex((tc) => tc.function.name === 'ask_questions')
      for (let j = 0; j < result.tool_calls.length; j++) {
        const tc = result.tool_calls[j]
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

        if (askIdx >= 0 && j !== askIdx) {
          // Hermana de ask_questions (o una segunda pregunta): no se ejecuta este turno.
          const ep = { ok: false, error: 'Pospuesto: el agente espera que respondas las preguntas.' }
          messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(ep) })
          await db.from('messages').insert({
            agent_id: agentId, task_id: null, conversation_id: convId,
            role: 'tool', tool_call_id: tc.id, content: JSON.stringify(ep),
            metadata: { source: 'chat', postponed: true },
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

        const toolRes = await runTool({ db, agentId, taskId: null, brandId: agent.brand_id ?? null, conversationId: convId }, tc)
        const durationMs = Date.now() - startedAt

        await db
          .from('tool_calls')
          .update({
            result: toolRes.data ?? null, error: toolRes.error ?? null,
            status: toolRes.ok ? 'success' : 'failed', duration_ms: durationMs,
            completed_at: new Date().toISOString(),
          })
          .eq('id', tcRow?.id ?? '')

        // Al CONTEXTO del LLM va la versión acotada (evita reventar el límite de
        // tokens); a la tabla `messages` va el JSON COMPLETO y válido, que es lo
        // que lee la UI para pintar las tarjetas. El íntegro también va en tool_calls.
        const fullContent = JSON.stringify(toolRes)
        messages.push({ role: 'tool', tool_call_id: tc.id, content: capToolResultForContext(toolRes) })
        await db.from('messages').insert({
          agent_id: agentId, task_id: null, conversation_id: convId,
          role: 'tool', tool_call_id: tc.id, content: fullContent, metadata: { source: 'chat' },
        })

        // ask_questions cierra el turno: el agente queda esperando que el usuario
        // responda el formulario; sus respuestas llegan como su siguiente mensaje.
        if (
          tc.function.name === 'request_approval' ||
          tc.function.name === 'escalate_to_ceo' ||
          tc.function.name === 'ask_questions'
        ) {
          didBlock = true
        }
      }

      if (didBlock) {
        finished = true
        break
      }
    }

    // Si es conversación nueva, mejoramos el título con un resumen del LLM
    // (corto, una frase). Best-effort: si falla, queda el título provisional.
    // No generamos título si el turno se cortó por límite de tokens: sería otra
    // llamada al MISMO proveedor recién saturado (casi seguro vuelve a fallar).
    if (isNewConversation && !stopReason) {
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
