// Un turno de un agente: lee su tarea activa, llama al LLM, ejecuta tools,
// itera hasta finish_task / blocked / max iterations, persiste todo en BD.
//
// Es idempotente a nivel de "tick": si una invocación cae a mitad, la siguiente
// vuelve a leer estado y continúa donde lo dejó.
import { adminDb } from './db.ts'
import { makeProvider, isRateOrSizeLimitError, type ChatMessage } from './llm.ts'
import { loadTools, runTool, toToolDefinitions, capToolResultForContext, capToolContentString } from './tools.ts'

const MAX_TOOL_ITERATIONS = 5
const HISTORY_WINDOW = 50

export interface RunStepResult {
  agent_id: string
  iterations: number
  finished: boolean
  reason?: string
  error?: string
}

export async function runAgentStep(agentId: string): Promise<RunStepResult> {
  const db = adminDb()

  const { data: agent, error: e1 } = await db
    .from('agents')
    .select('*')
    .eq('id', agentId)
    .maybeSingle()
  if (e1) return { agent_id: agentId, iterations: 0, finished: false, error: e1.message }
  if (!agent) return { agent_id: agentId, iterations: 0, finished: false, error: 'agent not found' }
  if (agent.status === 'disabled') {
    return { agent_id: agentId, iterations: 0, finished: false, reason: 'disabled' }
  }

  await db
    .from('agents')
    .update({ status: 'running', last_heartbeat_at: new Date().toISOString() })
    .eq('id', agentId)

  try {
    const { data: tasks } = await db
      .from('tasks')
      .select('*')
      .eq('agent_id', agentId)
      .in('status', ['to_do', 'in_progress'])
      .order('priority', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(1)

    const activeTask = tasks?.[0]
    if (!activeTask) {
      return { agent_id: agentId, iterations: 0, finished: true, reason: 'no active tasks' }
    }

    if (activeTask.status === 'to_do') {
      await db.from('tasks').update({ status: 'in_progress' }).eq('id', activeTask.id)
    }

    // F5 tope de costo (fail-closed): si el agente agotó su presupuesto de tokens del
    // día, paramos y marcamos la tarea para revisión humana (no quema más tokens).
    const dailyBudget = ((agent.config ?? {}) as { daily_token_budget?: number }).daily_token_budget ?? 3_000_000
    const { data: spentRaw } = await db.rpc('agent_tokens_today', { p_agent_id: agentId })
    if (Number(spentRaw ?? 0) >= dailyBudget) {
      await db
        .from('tasks')
        .update({ status: 'needs_review', result: { governance: `tope de tokens del día alcanzado (${Number(spentRaw)}/${dailyBudget})` } })
        .eq('id', activeTask.id)
      return { agent_id: agentId, iterations: 0, finished: false, reason: 'token_budget_exceeded' }
    }

    // Historia de mensajes del agente (todos los hilos, los últimos N).
    // Para brand managers / CEO el contexto se consolida así. En el futuro
    // podríamos limitar por task_id si la conversación crece mucho.
    const { data: history } = await db
      .from('messages')
      .select('id, role, content, tool_call_id, tool_calls, task_id, created_at')
      .eq('agent_id', agentId)
      .order('created_at', { ascending: false })
      .limit(HISTORY_WINDOW)

    const historyAsc = (history ?? []).slice().reverse()

    const toolDescs = await loadTools((agent.allowed_tools ?? []) as string[])
    const toolDefs = toToolDefinitions(toolDescs)

    const messages: ChatMessage[] = []
    messages.push({ role: 'system', content: agent.system_prompt })

    for (const m of historyAsc) {
      messages.push({
        role: m.role,
        // Los resultados de tool se guardan en JSON completo (lo lee la UI); al
        // recargarlos al contexto del LLM los re-acotamos para no inflar el request.
        content: m.role === 'tool' && typeof m.content === 'string'
          ? capToolContentString(m.content)
          : m.content,
        tool_call_id: m.tool_call_id ?? undefined,
        tool_calls: m.tool_calls ?? undefined,
      })
    }

    // ¿Es la primera vez que vemos esta tarea? Heurística: buscar en la
    // historia un mensaje user con la marca [Tarea <id>]
    const taskMarker = `[Tarea ${activeTask.id}]`
    const seenInHistory = historyAsc.some(
      (m) => m.role === 'user' && typeof m.content === 'string' && m.content.includes(taskMarker),
    )

    if (!seenInHistory) {
      const directive = formatTaskDirective(activeTask)
      messages.push({ role: 'user', content: directive })
      await db.from('messages').insert({
        agent_id: agentId,
        task_id: activeTask.id,
        role: 'user',
        content: directive,
      })
    }

    const provider = makeProvider(agent.provider ?? 'groq')
    const cfg = (agent.config ?? {}) as { temperature?: number; max_tokens?: number }

    let iterations = 0
    let finished = false

    while (iterations < MAX_TOOL_ITERATIONS) {
      iterations++

      let result
      try {
        result = await provider.complete({
          model: agent.model,
          messages,
          tools: toolDefs.length > 0 ? toolDefs : undefined,
          temperature: cfg.temperature ?? 0.4,
          max_tokens: cfg.max_tokens ?? 1500,
        })
      } catch (e) {
        if (!isRateOrSizeLimitError(e)) throw e
        // Degradación con gracia: dejamos nota y cerramos el tick sin crashear.
        // La tarea sigue 'in_progress' → el próximo tick reintenta con menos contexto.
        await db.from('messages').insert({
          agent_id: agentId,
          task_id: activeTask.id,
          role: 'assistant',
          content:
            '⚠️ Límite de tokens por minuto del proveedor alcanzado en este tick. ' +
            'Reintentaré en el próximo ciclo; conviene acotar el alcance de la tarea.',
          metadata: { error: 'rate_or_size_limit' },
        })
        return { agent_id: agentId, iterations, finished: false, reason: 'rate_or_size_limit' }
      }

      const assistantTurn: ChatMessage = {
        role: 'assistant',
        content: result.content,
        tool_calls: result.tool_calls.length > 0 ? result.tool_calls : undefined,
      }
      messages.push(assistantTurn)

      const { data: insertedAssistant } = await db
        .from('messages')
        .insert({
          agent_id: agentId,
          task_id: activeTask.id,
          role: 'assistant',
          content: result.content,
          tool_calls: result.tool_calls.length > 0 ? result.tool_calls : null,
          metadata: { usage: result.usage, finish_reason: result.finish_reason },
        })
        .select('id')
        .single()

      if (result.tool_calls.length === 0) {
        finished = true
        break
      }

      let didFinishTask = false
      let didBlock = false

      for (const tc of result.tool_calls) {
        const isAllowed = (agent.allowed_tools ?? []).includes(tc.function.name)
        if (!isAllowed) {
          const errPayload = { ok: false, error: `Tool no permitida para este agente: ${tc.function.name}` }
          messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(errPayload) })
          await db.from('messages').insert({
            agent_id: agentId,
            task_id: activeTask.id,
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify(errPayload),
          })
          continue
        }

        const startedAt = Date.now()
        const { data: tcRow } = await db
          .from('tool_calls')
          .insert({
            agent_id: agentId,
            task_id: activeTask.id,
            message_id: insertedAssistant?.id ?? null,
            tool_name: tc.function.name,
            args: safeParseJson(tc.function.arguments),
            status: 'running',
          })
          .select('id')
          .single()

        const toolRes = await runTool(
          { db, agentId, taskId: activeTask.id, brandId: agent.brand_id ?? null },
          tc,
        )

        const durationMs = Date.now() - startedAt

        await db
          .from('tool_calls')
          .update({
            result: toolRes.data ?? null,
            error: toolRes.error ?? null,
            status: toolRes.ok ? 'success' : 'failed',
            duration_ms: durationMs,
            completed_at: new Date().toISOString(),
          })
          .eq('id', tcRow?.id ?? '')

        // Al CONTEXTO del LLM va la versión acotada; a la tabla `messages` va el
        // JSON COMPLETO y válido (lo lee la UI). El íntegro también va en tool_calls.
        const fullContent = JSON.stringify(toolRes)
        messages.push({ role: 'tool', tool_call_id: tc.id, content: capToolResultForContext(toolRes) })
        await db.from('messages').insert({
          agent_id: agentId,
          task_id: activeTask.id,
          role: 'tool',
          tool_call_id: tc.id,
          content: fullContent,
        })

        if (tc.function.name === 'finish_task' && toolRes.ok) {
          didFinishTask = true
          // Protocolo Aetherna: disparar auto-distill en background (fire-and-forget)
          triggerAutoDistill(agentId, activeTask.id, agent.brand_id ?? null).catch(() => null)
        }
        if (tc.function.name === 'request_approval' || tc.function.name === 'escalate_to_ceo') didBlock = true
        // F4: delegar cierra el turno — el agente queda esperando a los subordinados
        // (delegate_task ya dejó esta tarea en 'blocked'); finish_task del último hijo la reactiva.
        if (tc.function.name === 'delegate_task' && toolRes.ok) didBlock = true
      }

      if (didFinishTask || didBlock) {
        finished = true
        break
      }
      // Si no, iteramos: el modelo necesita ver los tool results y decidir.
    }

    return { agent_id: agentId, iterations, finished }
  } finally {
    // Volvemos a idle al terminar el tick. Si la task quedó bloqueada por
    // approval/escalation, eso queda reflejado en `tasks.status`, no en el agente.
    await db.from('agents').update({ status: 'idle' }).eq('id', agentId)
  }
}

// Dispara auto-distill sin bloquear el runtime del agente (fire-and-forget)
async function triggerAutoDistill(agentId: string, taskId: string, brandId: string | null): Promise<void> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceKey) return

  await fetch(`${supabaseUrl}/functions/v1/auto-distill`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({ task_id: taskId, agent_id: agentId, brand_id: brandId }),
  })
}

function formatTaskDirective(task: { id: string; title: string; description?: string; due_at?: string }): string {
  const parts = [
    `[Tarea ${task.id}] ${task.title}`,
    '',
    task.description ?? '',
  ]
  if (task.due_at) parts.push(`Deadline: ${task.due_at}`)
  parts.push('', 'Cuando termines, llama `finish_task` con tu resumen.')
  return parts.join('\n')
}

function safeParseJson(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return { _raw: s }
  }
}
