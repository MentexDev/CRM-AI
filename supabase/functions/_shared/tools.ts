// Tools core ejecutables por los agentes.
// Cada handler recibe (ctx, args) y devuelve un ToolResult serializable a JSON.
// El runtime persiste cada invocación en `tool_calls` y el resultado se
// reinyecta al modelo como mensaje role='tool' en la siguiente iteración.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@^2'
import type { ToolCallRequest, ToolDefinition } from './llm.ts'
import { embedText } from './llm.ts'
import { runIngestPipeline } from './ingest.ts'
import { runQueryPipeline, formatForAgent } from './query.ts'
import { adminDb } from './db.ts'
import { shopifyAdjustInventory, shopifyGetInventoryBySku, shopifyGraphQL, stripGid } from './shopify.ts'
import { generateImage as generateImageMulti } from './imageGen.ts'
import { tavilySearch } from './tavily.ts'
import { getSales, salesRange, periodWarning } from './suitecrm.ts'
import { defineTool, ToolRegistry } from './tool-kit.ts'
import { TOOL_SPECS } from './tool-specs.ts'
import {
  calendarCreateEvent as gcalCreate,
  calendarListEvents as gcalList,
  googleCalendarId,
  googleConfigured,
} from './google.ts'

export interface ToolDescriptor {
  name: string
  description: string
  category: string
  args_schema: Record<string, unknown>
  requires_approval: boolean
  is_active: boolean
}

export interface ToolContext {
  db: SupabaseClient
  agentId: string
  taskId: string | null
  brandId: string | null
  conversationId?: string | null
}

export interface ToolResult {
  ok: boolean
  data?: unknown
  error?: string
  side_effect?: { kind: string; id: string }
}

// Tope del resultado de una tool al REINYECTARLO al CONTEXTO del LLM.
//
// IMPORTANTE: esto SOLO acota lo que se mete al array `messages` que se manda al
// modelo. En la tabla `messages` se guarda el JSON COMPLETO y válido (lo lee la
// UI para pintar las tarjetas) y el resultado íntegro también vive en
// `tool_calls.result`. Capear aquí evita reventar el límite de tokens del
// proveedor (Groq free tier = 12k tok/min) SIN degradar la UI ni perder datos.
//
// El recorte es ESTRUCTURAL (por items del array, no cortando el string), así el
// modelo recibe siempre JSON VÁLIDO y honesto: los primeros K elementos + cuántos
// se omitieron (`_truncated_items`), conservando campos como `count`/`filters`.
const TOOL_RESULT_MAX_CHARS = 5000

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v) ?? String(v)
  } catch {
    return String(v)
  }
}

// Reduce un ToolResult para que su serialización quepa en `maxChars` devolviendo
// SIEMPRE un objeto serializable a JSON válido. Maneja `data: [..]` (array directo)
// y `data: { <array>, ... }` (array dentro de un objeto). Si no calza, cae a un
// wrapper válido con un preview textual.
function shrinkResultToFit(result: unknown, maxChars: number): unknown {
  if (!result || typeof result !== 'object') {
    return { _truncated: true, preview: safeStringify(result).slice(0, maxChars) }
  }
  const r = result as Record<string, unknown>
  const data = r.data

  if (Array.isArray(data)) {
    for (let k = data.length - 1; k >= 0; k--) {
      const candidate = { ...r, data: data.slice(0, k), _truncated_items: data.length - k }
      if (safeStringify(candidate).length <= maxChars) return candidate
    }
  } else if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>
    const arrayKey = Object.keys(d).find((k) => Array.isArray(d[k]))
    if (arrayKey) {
      const arr = d[arrayKey] as unknown[]
      for (let k = arr.length - 1; k >= 0; k--) {
        const candidate = { ...r, data: { ...d, [arrayKey]: arr.slice(0, k), _truncated_items: arr.length - k } }
        if (safeStringify(candidate).length <= maxChars) return candidate
      }
    }
  }
  // Fallback: ni con el array vacío cabe (otros campos enormes) o forma inesperada.
  return {
    ok: (r as { ok?: unknown }).ok ?? true,
    _truncated: true,
    preview: safeStringify(r).slice(0, Math.max(0, maxChars - 200)),
  }
}

// F5 tope de costo: ¿el agente superó su presupuesto de tokens del día? Pura y
// testeable. budgetExceeded NO cubre el caso de error de la RPC (eso lo maneja el
// caller, fail-closed). Default generoso (3M); configurable en agent.config.
export function dailyBudgetExceeded(
  spentRaw: unknown,
  config: { daily_token_budget?: number } | null | undefined,
): boolean {
  const budget = (config ?? {}).daily_token_budget ?? 3_000_000
  return Number(spentRaw ?? 0) >= budget
}

// Versión acotada de un ToolResult (objeto) para el contexto del LLM. JSON válido.
export function capToolResultForContext(result: unknown, maxChars = TOOL_RESULT_MAX_CHARS): string {
  const full = safeStringify(result)
  if (full.length <= maxChars) return full
  return safeStringify(shrinkResultToFit(result, maxChars))
}

// Igual, pero partiendo del `content` ya serializado de un mensaje role='tool'
// del historial. Lo re-parsea para recortar estructuralmente; si no es JSON,
// recorta por string con un marcador (caso de filas viejas/no-JSON).
export function capToolContentString(content: string, maxChars = TOOL_RESULT_MAX_CHARS): string {
  if (content.length <= maxChars) return content
  try {
    return capToolResultForContext(JSON.parse(content), maxChars)
  } catch {
    return content.slice(0, maxChars) + '\n\n…[contenido recortado para el contexto]'
  }
}

// Filtra del historial los mensajes 'tool' HUÉRFANOS: aquellos cuyo tool_call_id no fue
// declarado por un 'assistant' precedente DENTRO de la ventana. Si la ventana de historial
// corta a mitad de un turno previo (hilos largos: el de reportes reusado, tareas autónomas),
// reenviar un 'tool' sin su 'assistant'+tool_calls hace que el proveedor (OpenAI-compat /
// Anthropic) devuelva 400. Pura y testeable; se usa en agent_chat y agent_step.
export function dropOrphanToolMessages<
  T extends { role: string; tool_call_id?: string | null; tool_calls?: unknown },
>(historyAsc: T[]): T[] {
  const declared = new Set<string>()
  return historyAsc.filter((m) => {
    if (Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls as { id?: string }[]) if (tc?.id) declared.add(tc.id)
    }
    if (m.role === 'tool') return m.tool_call_id ? declared.has(m.tool_call_id) : false
    return true
  })
}

// Fase 1.5: las tools se cargan del REGISTRY (código), ya no de la BD. Se
// conserva la firma async + ToolDescriptor[] por compatibilidad con los callers.
export async function loadTools(names: string[]): Promise<ToolDescriptor[]> {
  if (!names || names.length === 0) return []
  const set = new Set(names)
  return toolRegistry
    .all()
    .filter((t) => set.has(t.name))
    .map((t) => ({
      name: t.name,
      description: t.description,
      category: t.category,
      args_schema: t.parameters,
      requires_approval: t.requiresApproval,
      is_active: t.isActive,
    }))
}

export function toToolDefinitions(tools: ToolDescriptor[]): ToolDefinition[] {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.args_schema,
    },
  }))
}

// Fase 1.5: el despacho vive en el ToolRegistry (tool-kit.ts), que conserva la
// misma defensa de args (`"null"`/`"undefined"`/JSON inválido → {} o error claro).
export async function runTool(
  ctx: ToolContext,
  call: ToolCallRequest,
): Promise<ToolResult> {
  return toolRegistry.run(ctx, call)
}

// =====================================================================
// Handlers core
// =====================================================================

async function delegateTask(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const agentSlug = args.agent_slug as string | undefined
  const title = args.title as string | undefined
  const objective = args.objective as string | undefined
  if (!agentSlug || !title || !objective) {
    return { ok: false, error: 'Faltan campos requeridos: agent_slug, title, objective' }
  }

  const { data: target, error: e1 } = await ctx.db
    .from('agents')
    .select('id, brand_id, parent_agent_id, status')
    .eq('slug', agentSlug)
    .maybeSingle()
  if (e1) return { ok: false, error: e1.message }
  if (!target) return { ok: false, error: `Agente no encontrado: ${agentSlug}` }
  if (target.parent_agent_id !== ctx.agentId) {
    return {
      ok: false,
      error: `${agentSlug} no es subordinado tuyo. No puedes delegarle.`,
    }
  }

  const description = [
    `Objetivo: ${objective}`,
    args.context ? `Contexto: ${args.context}` : null,
    args.success_criteria ? `Criterio de éxito: ${args.success_criteria}` : null,
  ]
    .filter(Boolean)
    .join('\n\n')

  const { data: task, error: e2 } = await ctx.db
    .from('tasks')
    .insert({
      brand_id: target.brand_id,
      agent_id: target.id,
      parent_task_id: ctx.taskId ?? null,
      title,
      description,
      status: 'to_do',
      priority: typeof args.priority === 'number' ? args.priority : 3,
      due_at: args.due_at ?? null,
      created_by_agent_id: ctx.agentId,
      context: { delegated_from_agent: ctx.agentId, raw_args: args },
    })
    .select('id')
    .single()
  if (e2) return { ok: false, error: e2.message }

  // F4: si delegamos DENTRO de una tarea (no en chat), la tarea del que delega
  // queda BLOQUEADA esperando a los subordinados. finish_task del hijo la reactiva
  // cuando TODOS los hijos terminan, para que el padre agregue los resultados.
  if (ctx.taskId) {
    await ctx.db.from('tasks').update({ status: 'blocked' }).eq('id', ctx.taskId)
  }

  return {
    ok: true,
    data: { task_id: task.id, assigned_to: agentSlug, parent_waiting: !!ctx.taskId },
    side_effect: { kind: 'task_created', id: task.id },
  }
}

async function requestApproval(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const trigger = args.trigger as string | undefined
  const summary = args.summary as string | undefined
  if (!trigger || !summary) return { ok: false, error: 'Faltan trigger o summary' }

  const { data, error } = await ctx.db
    .from('approvals')
    .insert({
      agent_id: ctx.agentId,
      task_id: ctx.taskId ?? null,
      brand_id: ctx.brandId ?? null,
      conversation_id: ctx.conversationId ?? null,
      trigger,
      summary,
      payload: (args.payload as object) ?? {},
      status: 'pending',
    })
    .select('id')
    .single()
  if (error) return { ok: false, error: error.message }

  if (ctx.taskId) {
    await ctx.db.from('tasks').update({ status: 'blocked' }).eq('id', ctx.taskId)
  }

  return {
    ok: true,
    data: {
      approval_id: data.id,
      status: 'pending',
      note: 'Aprobación pendiente. Tu trabajo en esta tarea queda bloqueado hasta que la Junta decida.',
    },
    side_effect: { kind: 'approval_created', id: data.id },
  }
}

async function saveMemory(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const kind = args.kind as string | undefined
  const content = args.content as string | undefined
  if (!kind || !content) return { ok: false, error: 'Faltan kind o content' }

  const { data, error } = await ctx.db
    .from('agent_memory')
    .insert({
      agent_id: ctx.agentId,
      brand_id: ctx.brandId ?? null,
      kind,
      content,
    })
    .select('id')
    .single()
  if (error) return { ok: false, error: error.message }
  return { ok: true, data: { memory_id: data.id } }
}

async function searchMemory(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const query = args.query as string | undefined
  const limit = (args.limit as number | undefined) ?? 5
  if (!query) return { ok: false, error: 'Falta query' }

  // Búsqueda semántica si hay OPENAI_API_KEY; fallback a ILIKE
  try {
    const vec = await embedText(query)
    const { data, error } = await ctx.db.rpc('search_agent_memory', {
      p_agent_id: ctx.agentId,
      p_embedding: JSON.stringify(vec),
      p_limit: limit,
    })
    if (!error && data && data.length > 0) {
      return {
        ok: true,
        data: {
          matches: data,
          method: 'semantic',
        },
      }
    }
  } catch {
    // Sin OPENAI_API_KEY o falla el embed → caemos al fallback
  }

  const { data, error } = await ctx.db
    .from('agent_memory')
    .select('id, kind, content, created_at')
    .eq('agent_id', ctx.agentId)
    .ilike('content', `%${query}%`)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) return { ok: false, error: error.message }

  return {
    ok: true,
    data: {
      matches: data ?? [],
      method: 'keyword',
      note: (data ?? []).length === 0 ? 'No se encontraron memorias para esa búsqueda.' : undefined,
    },
  }
}

async function finishTask(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const taskId = args.task_id as string | undefined
  const summary = args.result_summary as string | undefined
  if (!taskId || !summary) return { ok: false, error: 'Faltan task_id o result_summary' }

  const { data: task, error: e1 } = await ctx.db
    .from('tasks')
    .select('id, agent_id, parent_task_id')
    .eq('id', taskId)
    .maybeSingle()
  if (e1) return { ok: false, error: e1.message }
  if (!task) return { ok: false, error: 'Tarea no encontrada' }
  if (task.agent_id !== ctx.agentId) return { ok: false, error: 'Esa tarea no te pertenece' }

  const { error: e2 } = await ctx.db
    .from('tasks')
    .update({
      status: 'done',
      result: { summary, data: (args.result_data as object) ?? {} },
    })
    .eq('id', taskId)
  if (e2) return { ok: false, error: e2.message }

  // F4: si esta tarea era un subtask delegado, avisamos al PADRE con el resultado
  // y, si TODOS los hermanos ya terminaron, reactivamos la tarea del padre para que
  // el agente superior agregue los resultados y cierre. Así la delegación es de ida y vuelta.
  if (task.parent_task_id) {
    const { data: parent } = await ctx.db
      .from('tasks')
      .select('id, agent_id')
      .eq('id', task.parent_task_id)
      .maybeSingle()
    if (parent) {
      const { data: me } = await ctx.db.from('agents').select('name').eq('id', ctx.agentId).maybeSingle()
      await ctx.db.from('messages').insert({
        agent_id: parent.agent_id,
        task_id: parent.id,
        role: 'user',
        content: `[Subordinado ${me?.name ?? ctx.agentId}] completó su subtarea: ${summary}`,
        metadata: { from_subtask: taskId },
      })
      // Reactivamos si NINGÚN hijo sigue ACTIVO (to_do/in_progress) — así un hijo
      // bloqueado/fallido no deja al padre colgado para siempre (no exigimos que
      // TODOS estén 'done'). El backstop del heartbeat cubre además las carreras.
      const { count } = await ctx.db
        .from('tasks')
        .select('id', { count: 'exact', head: true })
        .eq('parent_task_id', task.parent_task_id)
        .in('status', ['to_do', 'in_progress'])
      if ((count ?? 0) === 0) {
        await ctx.db.from('messages').insert({
          agent_id: parent.agent_id,
          task_id: parent.id,
          role: 'user',
          content: 'Todos tus subordinados terminaron sus subtareas (resultados arriba). Agrégalos y finaliza tu tarea con finish_task.',
        })
        await ctx.db.from('tasks').update({ status: 'in_progress' }).eq('id', task.parent_task_id)
      }
    }
  }

  return { ok: true, data: { task_id: taskId, status: 'done' } }
}

async function escalateToCeo(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const reason = args.reason as string | undefined
  const question = args.question as string | undefined
  if (!reason || !question) return { ok: false, error: 'Faltan reason o question' }

  const { data: ceo, error: e1 } = await ctx.db
    .from('agents')
    .select('id')
    .eq('role', 'ceo_global')
    .maybeSingle()
  if (e1) return { ok: false, error: e1.message }
  if (!ceo) return { ok: false, error: 'No hay CEO Global registrado' }

  const title = `Escalación: ${question.substring(0, 80)}`
  const description = `Razón: ${reason}\n\nPregunta: ${question}`

  const { data: task, error: e2 } = await ctx.db
    .from('tasks')
    .insert({
      brand_id: ctx.brandId ?? null,
      agent_id: ceo.id,
      parent_task_id: ctx.taskId ?? null,
      title,
      description,
      status: 'to_do',
      priority: 2,
      created_by_agent_id: ctx.agentId,
      context: { escalation: true, source_agent: ctx.agentId },
    })
    .select('id')
    .single()
  if (e2) return { ok: false, error: e2.message }

  if (ctx.taskId) {
    await ctx.db.from('tasks').update({ status: 'blocked' }).eq('id', ctx.taskId)
  }

  return {
    ok: true,
    data: {
      ceo_task_id: task.id,
      note: 'Escalado al CEO. Tu tarea queda bloqueada hasta que él responda.',
    },
  }
}

async function readKpis(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  if (!ctx.brandId) return { ok: false, error: 'Este agente no está asociado a una marca' }

  let q = ctx.db.from('brand_kpis').select('*').eq('brand_id', ctx.brandId)
  if (typeof args.metric === 'string') q = q.eq('metric', args.metric)
  if (typeof args.since === 'string') q = q.gte('recorded_at', args.since)

  const { data, error } = await q.order('recorded_at', { ascending: false }).limit(100)
  if (error) return { ok: false, error: error.message }

  return {
    ok: true,
    data: {
      kpis: data ?? [],
      note: (data ?? []).length === 0 ? 'Aún no hay KPIs alimentados para esta marca.' : undefined,
    },
  }
}

// =====================================================================
// Shopify · lectura (sin aprobación)
// =====================================================================

async function shopifySearchProducts(
  _ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const query = (args.query as string) || ''
  const limit = Math.min((args.limit as number) || 10, 25)
  try {
    const data = await shopifyGraphQL<{
      products: { edges: Array<{ node: Record<string, unknown> }> }
    }>(
      `query Products($q: String, $first: Int!) {
        products(first: $first, query: $q, sortKey: UPDATED_AT, reverse: true) {
          edges {
            node {
              id
              title
              handle
              status
              vendor
              productType
              tags
              totalInventory
              updatedAt
              priceRangeV2 {
                minVariantPrice { amount currencyCode }
                maxVariantPrice { amount currencyCode }
              }
            }
          }
        }
      }`,
      { q: query, first: limit },
    )
    const products = data.products.edges.map(({ node }) => {
      const n = node as {
        id: string
        title: string
        handle: string
        status: string
        vendor: string
        productType: string
        tags: string[]
        totalInventory: number
        updatedAt: string
        priceRangeV2: {
          minVariantPrice: { amount: string; currencyCode: string }
          maxVariantPrice: { amount: string; currencyCode: string }
        }
      }
      return {
        id: stripGid(n.id),
        title: n.title,
        handle: n.handle,
        status: n.status,
        vendor: n.vendor,
        product_type: n.productType,
        tags: n.tags,
        total_inventory: n.totalInventory,
        price_min: Number(n.priceRangeV2.minVariantPrice.amount),
        price_max: Number(n.priceRangeV2.maxVariantPrice.amount),
        currency: n.priceRangeV2.minVariantPrice.currencyCode,
        updated_at: n.updatedAt,
      }
    })
    return {
      ok: true,
      data: { products, count: products.length, query },
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// Convierte expresiones como "30 days ago", "yesterday", "last week" a una
// fecha ISO (YYYY-MM-DD). Acepta también ISO directo y lo retorna tal cual.
// Retorna null si no entiende la expresión.
function parseDateExpression(s: string | undefined | null): string | null {
  if (!s) return null
  const trimmed = String(s).trim().toLowerCase()
  // Si ya es ISO (al menos YYYY-MM-DD), lo respetamos
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed
  const now = new Date()
  const offsetDays = (n: number) => {
    const d = new Date(now)
    d.setDate(d.getDate() - n)
    return d.toISOString().slice(0, 10)
  }
  if (trimmed === 'today') return offsetDays(0)
  if (trimmed === 'yesterday') return offsetDays(1)
  if (trimmed === 'last week' || trimmed === 'last 7 days') return offsetDays(7)
  if (trimmed === 'last month' || trimmed === 'last 30 days') return offsetDays(30)
  if (trimmed === 'last 90 days' || trimmed === 'last quarter') return offsetDays(90)
  // "X days ago" / "X day ago" / "X weeks ago" / "X months ago"
  const m = trimmed.match(/^(\d+)\s+(day|days|week|weeks|month|months)\s+ago$/)
  if (m) {
    const n = parseInt(m[1], 10)
    const unit = m[2]
    const days = unit.startsWith('week') ? n * 7 : unit.startsWith('month') ? n * 30 : n
    return offsetDays(days)
  }
  return null
}

async function shopifyRecentOrders(
  _ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const limit = Math.min((args.limit as number) || 20, 25)
  const status = (args.status as string) || ''
  const sinceRaw = args.since as string | undefined
  const since = parseDateExpression(sinceRaw)
  // Query Shopify uses syntax like "financial_status:paid created_at:>2024-01-01"
  let q = ''
  if (status) q += `financial_status:${status} `
  if (since) q += `created_at:>='${since}' `

  try {
    const data = await shopifyGraphQL<{
      orders: { edges: Array<{ node: Record<string, unknown> }> }
    }>(
      `query Orders($q: String, $first: Int!) {
        orders(first: $first, query: $q, sortKey: CREATED_AT, reverse: true) {
          edges {
            node {
              id
              name
              createdAt
              displayFinancialStatus
              displayFulfillmentStatus
              totalPriceSet { shopMoney { amount currencyCode } }
              subtotalPriceSet { shopMoney { amount } }
              totalShippingPriceSet { shopMoney { amount } }
              totalDiscountsSet { shopMoney { amount } }
              customer { displayName email }
              lineItems(first: 10) {
                edges {
                  node {
                    title
                    quantity
                    sku
                  }
                }
              }
            }
          }
        }
      }`,
      { q: q.trim(), first: limit },
    )
    const orders = data.orders.edges.map(({ node }) => {
      const n = node as Record<string, unknown> & {
        customer?: { displayName?: string; email?: string }
        lineItems: { edges: Array<{ node: { title: string; quantity: number; sku: string } }> }
        totalPriceSet: { shopMoney: { amount: string; currencyCode: string } }
        subtotalPriceSet: { shopMoney: { amount: string } }
        totalShippingPriceSet: { shopMoney: { amount: string } }
        totalDiscountsSet: { shopMoney: { amount: string } }
      }
      return {
        id: stripGid(n.id as string),
        name: n.name as string,
        created_at: n.createdAt as string,
        financial_status: n.displayFinancialStatus as string,
        fulfillment_status: n.displayFulfillmentStatus as string,
        total: Number(n.totalPriceSet.shopMoney.amount),
        subtotal: Number(n.subtotalPriceSet.shopMoney.amount),
        shipping: Number(n.totalShippingPriceSet.shopMoney.amount),
        discount: Number(n.totalDiscountsSet.shopMoney.amount),
        currency: n.totalPriceSet.shopMoney.currencyCode,
        customer_name: n.customer?.displayName ?? null,
        customer_email: n.customer?.email ?? null,
        items: n.lineItems.edges.map(({ node: li }) => ({
          title: li.title,
          quantity: li.quantity,
          sku: li.sku,
        })),
      }
    })
    return {
      ok: true,
      data: {
        orders,
        count: orders.length,
        filters: { status, since: since ?? null, since_input: sinceRaw ?? null },
      },
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

async function shopifySearchCustomers(
  _ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const query = (args.query as string) || ''
  const limit = Math.min((args.limit as number) || 10, 25)
  try {
    const data = await shopifyGraphQL<{
      customers: { edges: Array<{ node: Record<string, unknown> }> }
    }>(
      `query Customers($q: String, $first: Int!) {
        customers(first: $first, query: $q, sortKey: UPDATED_AT, reverse: true) {
          edges {
            node {
              id
              displayName
              email
              phone
              createdAt
              numberOfOrders
              amountSpent { amount currencyCode }
              tags
            }
          }
        }
      }`,
      { q: query, first: limit },
    )
    const customers = data.customers.edges.map(({ node }) => {
      const n = node as {
        id: string
        displayName: string
        email: string
        phone: string | null
        createdAt: string
        numberOfOrders: string
        amountSpent: { amount: string; currencyCode: string }
        tags: string[]
      }
      return {
        id: stripGid(n.id),
        name: n.displayName,
        email: n.email,
        phone: n.phone,
        created_at: n.createdAt,
        orders_count: Number(n.numberOfOrders),
        total_spent: Number(n.amountSpent.amount),
        currency: n.amountSpent.currencyCode,
        tags: n.tags,
      }
    })
    return {
      ok: true,
      data: { customers, count: customers.length, query },
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// =====================================================================
// Higgsfield · generación de imágenes (text-to-image)
// =====================================================================
// =====================================================================
// Web search · Tavily
// =====================================================================
async function webSearch(
  _ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const query = (args.query as string)?.trim()
  const limit = Math.min((args.limit as number) || 5, 10)
  const depth = (args.depth as 'basic' | 'advanced') || 'basic'
  const topic = (args.topic as 'general' | 'news') || 'general'
  if (!query) return { ok: false, error: 'Falta query' }
  try {
    const result = await tavilySearch(query, { maxResults: limit, depth, topic })
    return {
      ok: true,
      data: {
        query: result.query,
        answer: result.answer ?? null,
        results: result.results.map((r) => ({
          title: r.title,
          url: r.url,
          // Truncar el content para no inflar contexto del modelo. Si el
          // agente necesita más, puede hacer otra búsqueda más específica.
          content: r.content.length > 500 ? r.content.slice(0, 500) + '…' : r.content,
          published_date: r.published_date ?? null,
          score: r.score,
        })),
        count: result.results.length,
      },
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

async function generateImage(
  _ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const prompt = (args.prompt as string)?.trim()
  const aspectRatio = (args.aspect_ratio as string) || '1:1'
  const styleHint = args.style_hint as string | undefined
  // URLs de referencia (producto real de NINA, modelo) → Gemini las usa como base.
  const referenceImageUrls = Array.isArray(args.reference_image_urls)
    ? (args.reference_image_urls as unknown[]).filter((u) => typeof u === 'string' && u.trim()).map((u) => String(u).trim())
    : undefined
  if (!prompt) return { ok: false, error: 'Falta prompt' }
  try {
    const result = await generateImageMulti(prompt, aspectRatio, styleHint, referenceImageUrls)
    const requested = referenceImageUrls?.length ?? 0
    const applied = result.referencesApplied ?? 0
    const data: Record<string, unknown> = {
      images: result.urls.map((url) => ({ url })),
      prompt,
      aspect_ratio: aspectRatio,
      provider: result.provider,
      references_used: applied, // lo realmente APLICADO, no lo pedido (no mentir al agente)
    }
    // Si se pidieron referencias pero NINGUNA se aplicó (provider sin soporte o fallback),
    // avisamos explícito para que el agente NO presente la imagen como el producto real.
    if (requested > 0 && applied === 0) {
      data.warning =
        'Las imágenes de referencia NO se aplicaron (el proveedor actual no las soporta o Gemini falló): la imagen es genérica y NO reproduce el producto/modelo de referencia. NO la presentes como la prenda real; avísale al usuario.'
    }
    return { ok: true, data }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// =====================================================================
// Shopify · inventario (lectura + escritura con umbral)
// =====================================================================

async function shopifyGetInventory(
  _ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const sku = (args.sku as string)?.trim()
  if (!sku) return { ok: false, error: 'Falta SKU' }
  try {
    const levels = await shopifyGetInventoryBySku(sku)
    const total = levels.reduce((acc, l) => acc + l.available, 0)
    return { ok: true, data: { sku, total_available: total, levels } }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// Umbrales para auto-aprobación. Si |delta| supera, se crea approval y NO
// se ejecuta — la junta debe aprobar y un edge function execute-approval
// procesará la operación con los args guardados en payload.
const INVENTORY_UNIT_THRESHOLD = 20

async function shopifyAdjustInventoryHandler(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const sku = (args.sku as string)?.trim()
  const locationId = (args.location_id as string)?.trim()
  const delta = Number(args.delta)
  const reason = (args.reason as string)?.trim() || 'correction'

  if (!sku) return { ok: false, error: 'Falta SKU' }
  if (!locationId) return { ok: false, error: 'Falta location_id (úsalo desde shopify_get_inventory)' }
  if (!delta || Number.isNaN(delta)) return { ok: false, error: 'Falta delta numérico (positivo para sumar, negativo para restar)' }

  const absDelta = Math.abs(delta)

  // Si supera el umbral, crear aprobación y NO ejecutar.
  if (absDelta > INVENTORY_UNIT_THRESHOLD) {
    const summary = `Ajustar inventario SKU ${sku}: ${delta > 0 ? '+' : ''}${delta} unidades en location ${locationId} (razón: ${reason}). Supera el umbral de ${INVENTORY_UNIT_THRESHOLD} unidades — requiere aprobación.`
    const { data: approval, error } = await ctx.db
      .from('approvals')
      .insert({
        agent_id: ctx.agentId,
        task_id: ctx.taskId ?? null,
        brand_id: ctx.brandId ?? null,
        trigger: 'inventory_threshold',
        summary,
        payload: {
          tool_name: 'shopify_adjust_inventory',
          args: { sku, location_id: locationId, delta, reason },
          threshold: INVENTORY_UNIT_THRESHOLD,
        },
        status: 'pending',
      })
      .select('id')
      .single()
    if (error) return { ok: false, error: error.message }

    if (ctx.taskId) {
      await ctx.db.from('tasks').update({ status: 'blocked' }).eq('id', ctx.taskId)
    }
    return {
      ok: false,
      error: `Cambio de ${absDelta} unidades supera el umbral de ${INVENTORY_UNIT_THRESHOLD}. Creé la aprobación ${approval.id} y bloqueé esta tarea hasta que la Junta decida. NO repitas la operación — cuando se apruebe, se ejecuta automáticamente.`,
      side_effect: { kind: 'approval_created', id: approval.id },
    }
  }

  // Bajo umbral: ejecutar directo
  try {
    const result = await shopifyAdjustInventory(sku, locationId, delta, reason)
    return { ok: true, data: { ...result, delta_applied: delta, reason } }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

async function shopifyShopSummary(
  _ctx: ToolContext,
  _args: Record<string, unknown>,
): Promise<ToolResult> {
  try {
    const data = await shopifyGraphQL<{
      shop: Record<string, unknown>
    }>(
      `query Shop {
        shop {
          name
          email
          myshopifyDomain
          primaryDomain { url }
          currencyCode
          ianaTimezone
          billingAddress { country }
          plan { displayName }
        }
      }`,
    )
    const s = data.shop as {
      name: string
      email: string
      myshopifyDomain: string
      primaryDomain: { url: string }
      currencyCode: string
      ianaTimezone: string
      billingAddress: { country: string }
      plan: { displayName: string }
    }
    return {
      ok: true,
      data: {
        name: s.name,
        email: s.email,
        myshopify_domain: s.myshopifyDomain,
        primary_url: s.primaryDomain?.url,
        currency: s.currencyCode,
        timezone: s.ianaTimezone,
        country: s.billingAddress?.country,
        plan: s.plan?.displayName,
      },
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// =====================================================================
// Brain · query_brain
// =====================================================================

async function queryBrain(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const query = (args.query as string)?.trim()
  if (!query) return { ok: false, error: 'Falta query' }
  if (!ctx.brandId) return { ok: false, error: 'Este agente no está asociado a una marca' }

  try {
    const result = await runQueryPipeline(
      {
        brandId:      ctx.brandId,
        query,
        limit:        (args.limit      as number  | undefined),
        sourceKind:   (args.source_kind as string  | undefined),
        minScore:     (args.min_score   as number  | undefined),
        includeGraph: true,
      },
      ctx.db,
    )

    return { ok: true, data: formatForAgent(result) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// =====================================================================
// Brain · ingest_document
// =====================================================================

async function ingestDocumentTool(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const title = (args.title as string)?.trim()
  const content = (args.content as string)?.trim()
  const sourceKind = (args.source_kind as string) || 'manual'
  const sourceUri = args.source_uri as string | undefined

  if (!title || !content) return { ok: false, error: 'Faltan title o content' }
  if (!ctx.brandId) return { ok: false, error: 'Este agente no está asociado a una marca' }

  try {
    const result = await runIngestPipeline(
      {
        brandId: ctx.brandId,
        title,
        content,
        sourceKind: sourceKind as Parameters<typeof runIngestPipeline>[0]['sourceKind'],
        sourceUri,
        agentId: ctx.agentId,
      },
      ctx.db,
    )

    return {
      ok: true,
      data: {
        document_id: result.documentId,
        chunks_created: result.chunksCreated,
        entities_created: result.entitiesCreated,
        relations_created: result.relationsCreated,
        duration_ms: result.durationMs,
      },
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// =====================================================================
// Brain · create_agent (solo CEO Global)
// =====================================================================

async function createAgentTool(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const name = (args.name as string)?.trim()
  const slug = (args.slug as string)?.trim()
  const role = args.role as string
  const specialty = (args.specialty as string) || ''
  const brandId = (args.brand_id as string) || null
  const parentAgentId = (args.parent_agent_id as string) || ctx.agentId
  const systemPrompt = (args.system_prompt as string)?.trim()
  const allowedTools = (args.allowed_tools as string[]) || []
  const model = (args.model as string) || 'llama-3.3-70b-versatile'
  const justification = (args.justification as string)?.trim()

  if (!name || !slug || !systemPrompt || !justification) {
    return { ok: false, error: 'Faltan campos: name, slug, system_prompt, justification' }
  }
  if (!['specialist', 'brand_manager'].includes(role)) {
    return { ok: false, error: 'role debe ser specialist o brand_manager' }
  }

  // Verificar que quien llama es CEO Global
  const { data: caller } = await ctx.db
    .from('agents')
    .select('role')
    .eq('id', ctx.agentId)
    .maybeSingle()
  if (caller?.role !== 'ceo_global') {
    return { ok: false, error: 'create_agent solo puede usarlo el CEO Global' }
  }

  const summary = `Crear agente "${name}" (${role}${specialty ? ' · ' + specialty : ''}). Justificación: ${justification}`

  const { data: approval, error: aErr } = await ctx.db
    .from('approvals')
    .insert({
      agent_id: ctx.agentId,
      task_id: ctx.taskId ?? null,
      brand_id: brandId ?? ctx.brandId ?? null,
      trigger: 'structural',
      summary,
      payload: {
        tool_name: 'create_agent',
        args: { name, slug, role, specialty, brand_id: brandId, parent_agent_id: parentAgentId, system_prompt: systemPrompt, allowed_tools: allowedTools, model },
      },
      status: 'pending',
    })
    .select('id')
    .single()
  if (aErr) return { ok: false, error: aErr.message }

  if (ctx.taskId) {
    await ctx.db.from('tasks').update({ status: 'blocked' }).eq('id', ctx.taskId)
  }

  return {
    ok: true,
    data: {
      approval_id: approval.id,
      status: 'pending',
      note: `Solicitud de creación del agente "${name}" enviada a la Junta. Cuando sea aprobada, el agente quedará activo automáticamente.`,
    },
    side_effect: { kind: 'approval_created', id: approval.id },
  }
}

// =====================================================================
// Comunicación · send_email (Resend)
// =====================================================================

// Envío real vía Resend, SIN gate. Lo reusan sendEmail (chat) y execute-approval
// (cuando la Junta aprueba un envío autónomo). Remitente: dominio verificado en
// RESEND_FROM; si falta, el de prueba de Resend (solo entrega al dueño de la cuenta).
export async function deliverEmail(
  recipients: string[],
  subject: string,
  body: string,
): Promise<ToolResult> {
  const apiKey = Deno.env.get('RESEND_API_KEY')
  if (!apiKey) return { ok: false, error: 'RESEND_API_KEY no está configurado en el servidor' }
  const from = Deno.env.get('RESEND_FROM') ?? 'NINA <onboarding@resend.dev>'
  const isHtml = /<[a-z][\s\S]*>/i.test(body)
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: recipients, subject, ...(isHtml ? { html: body } : { text: body }) }),
    })
    const data = await resp.json().catch(() => ({} as Record<string, unknown>))
    if (!resp.ok) {
      return { ok: false, error: `Resend ${resp.status}: ${JSON.stringify(data).slice(0, 300)}` }
    }
    const id = (data as { id?: string }).id ?? 'unknown'
    return { ok: true, data: { email_id: id, to: recipients, subject, from }, side_effect: { kind: 'email_sent', id } }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// Busca el último correo COMPUESTO (compose_email → canvas) en el hilo, para que
// send_email reutilice su HTML sin que el modelo tenga que re-serializar el HTML
// grande en el JSON del tool-call (fallaba con "Argumentos JSON inválidos").
async function lastComposedEmail(ctx: ToolContext): Promise<{ subject: string; html: string } | null> {
  let q = ctx.db
    .from('messages')
    .select('content')
    .eq('role', 'tool')
    .order('created_at', { ascending: false })
    .limit(12)
  // Acotamos al hilo correcto: por conversación en el chat, por tarea en lo autónomo.
  if (ctx.conversationId) q = q.eq('conversation_id', ctx.conversationId)
  else if (ctx.taskId) q = q.eq('task_id', ctx.taskId)
  else q = q.eq('agent_id', ctx.agentId)
  const { data } = await q
  for (const m of (data ?? []) as { content: unknown }[]) {
    if (typeof m.content !== 'string') continue
    try {
      const p = JSON.parse(m.content)
      if (p?.ok && p?.data?.kind === 'email' && p.data.html) {
        return { subject: String(p.data.subject ?? '(sin asunto)'), html: String(p.data.html) }
      }
    } catch { /* no es JSON / no es artefacto */ }
  }
  return null
}

async function sendEmail(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const to = (args.to as string)?.trim()
  let subject = (args.subject as string)?.trim()
  let body = (args.body as string)?.trim()

  // Si el modelo no pasó cuerpo (o asunto), reutilizamos el último correo COMPUESTO del
  // hilo (compose_email → canvas). Es EL flujo de campañas (componer → previsualizar →
  // enviar) y evita el fallo de re-serializar el HTML grande como argumento JSON.
  if (!body || !subject) {
    const composed = await lastComposedEmail(ctx)
    if (composed) {
      if (!body) body = composed.html
      if (!subject) subject = composed.subject
    }
  }

  if (!to) return { ok: false, error: 'Falta el destinatario: "to" es requerido.' }
  if (!body) {
    return {
      ok: false,
      error: 'No hay cuerpo para enviar. Compón el correo con compose_email (queda en el canvas) y luego llama send_email con solo "to"; o pasa "body" explícito.',
    }
  }
  if (!subject) return { ok: false, error: 'Falta el asunto (subject).' }

  const recipients = to.split(',').map((s) => s.trim()).filter(Boolean)
  if (recipients.length === 0) return { ok: false, error: 'No hay destinatarios válidos en "to"' }
  // Seguridad: formato + tope de destinatarios + largo del asunto (acota una prompt-injection).
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  const invalid = recipients.filter((r) => !EMAIL_RE.test(r))
  if (invalid.length > 0) {
    return { ok: false, error: `Destinatarios con formato inválido: ${invalid.slice(0, 3).join(', ')}` }
  }
  if (recipients.length > 25) {
    return { ok: false, error: `Demasiados destinatarios (${recipients.length}). Máximo 25 por envío.` }
  }
  if (subject.length > 200) return { ok: false, error: 'El asunto es demasiado largo (máx. 200 chars)' }

  // Aprobación: en contexto AUTÓNOMO (una tarea, ctx.taskId presente) enviar correo
  // requiere aprobación de la Junta — evita que una prompt-injection en los datos de
  // una tarea dispare correos sin supervisión. En el CHAT (sin task, el usuario está
  // presente y lo pidió) se envía directo (ya validado). execute-approval lo manda al aprobar.
  if (ctx.taskId) {
    const { data: approval, error } = await ctx.db
      .from('approvals')
      .insert({
        agent_id: ctx.agentId,
        task_id: ctx.taskId,
        brand_id: ctx.brandId ?? null,
        conversation_id: ctx.conversationId ?? null,
        trigger: 'send_email',
        summary: `Enviar correo "${subject}" a ${recipients.length} destinatario(s) — requiere aprobación de la Junta.`,
        payload: { tool_name: 'send_email', args: { to: recipients.join(','), subject, body } },
        status: 'pending',
      })
      .select('id')
      .single()
    if (error) return { ok: false, error: error.message }
    await ctx.db.from('tasks').update({ status: 'blocked' }).eq('id', ctx.taskId)
    return {
      ok: false,
      data: { pending_approval: true, approval_id: approval.id },
      error: `Envío pendiente de aprobación de la Junta. No reintentes — al aprobarse se envía solo.`,
      side_effect: { kind: 'approval_created', id: approval.id },
    }
  }

  return deliverEmail(recipients, subject, body)
}

// =====================================================================
// Canvas (F3) · compose_email — artefacto HTML previsualizable en el split-view
// =====================================================================

async function composeEmail(_ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const subject = (args.subject as string)?.trim()
  const html = (args.html as string)?.trim()
  if (!subject || !html) return { ok: false, error: 'Faltan subject o html' }
  // No envía nada: produce un artefacto que el canvas del chat renderiza en vivo
  // (kind:'email') para previsualizar/iterar antes de lanzar la campaña con send_email.
  return { ok: true, data: { kind: 'email', subject, html } }
}

// Preguntas aclaratorias (estilo AskUserQuestion). El agente las usa ante un pedido
// abierto/ambiguo (sobre todo en un chat nuevo) para precisar el requerimiento ANTES de
// producir nada. Produce un artefacto kind:'questions' que el chat renderiza como un
// formulario por pasos; las respuestas del usuario vuelven como su siguiente mensaje.
async function askQuestions(_ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const raw = Array.isArray(args.questions) ? args.questions : []
  const questions = raw
    .map((q) => {
      const item = (q ?? {}) as Record<string, unknown>
      const prompt = (item.prompt as string)?.trim()
      if (!prompt) return null
      const type = ['text', 'single', 'multi'].includes(item.type as string) ? (item.type as string) : 'text'
      const options = Array.isArray(item.options)
        ? item.options.map((o) => String(o).trim()).filter(Boolean).slice(0, 8)
        : []
      return {
        prompt: prompt.slice(0, 300),
        type,
        // Las opciones solo aplican a single/multi; text es respuesta libre.
        options: type === 'single' || type === 'multi' ? options : undefined,
      }
    })
    .filter(Boolean)
    .slice(0, 6)
  if (questions.length === 0) return { ok: false, error: 'Faltan preguntas (questions[].prompt)' }
  return { ok: true, data: { kind: 'questions', questions } }
}

// =====================================================================
// Google Calendar (service account, calendario de marca compartido)
// =====================================================================

async function calendarCreateEventTool(_ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  if (!googleConfigured()) {
    return { ok: false, error: 'Google Calendar aún no está conectado (falta el service account / calendar id en el servidor).' }
  }
  const title = (args.title as string)?.trim()
  if (!title) return { ok: false, error: 'Falta el título del evento' }
  const date = (args.date as string)?.trim() // YYYY-MM-DD → evento de día completo
  const start = (args.start as string)?.trim() // ISO con fecha y hora
  const end = (args.end as string)?.trim()
  const description = (args.description as string)?.trim()
  if (!date && !start) {
    return { ok: false, error: 'Indica `start` (fecha y hora ISO 8601) o `date` (YYYY-MM-DD para todo el día)' }
  }
  try {
    const ev = await gcalCreate(googleCalendarId()!, {
      title,
      description: description || undefined,
      date: date || undefined,
      startDateTime: start || undefined,
      endDateTime: end || undefined,
    })
    // Normalizamos el evento creado al MISMO shape que devuelve gcalList (id + start/end
    // aplanados a string); gcalCreate los entrega como objeto crudo de Google ({dateTime|date}).
    const flat = (v: unknown): string | null =>
      !v ? null : typeof v === 'string' ? v : ((v as { dateTime?: string; date?: string }).dateTime ?? (v as { date?: string }).date ?? null)
    const createdEvent = { id: ev.id, title: ev.summary, start: flat(ev.start), end: flat(ev.end), html_link: ev.html_link }
    // Tras crear, traemos la agenda próxima para pintar el CALENDARIO en el canvas.
    let events: unknown[] = []
    try {
      events = (await gcalList(googleCalendarId()!, { max: 15 })).events
    } catch {
      /* best-effort: si falla el listado, el evento igual quedó creado */
    }
    // Garantizamos que el evento recién creado SIEMPRE esté en la agenda (si el listado
    // falló o aún no lo refleja) → el canvas nunca muestra "vacío" tras crear con éxito.
    if (!events.some((e) => (e as { id?: unknown })?.id === ev.id)) {
      events = [createdEvent, ...events]
    }
    return {
      ok: true,
      data: {
        kind: 'calendar',
        created: createdEvent,
        events,
      },
      side_effect: { kind: 'calendar_event_created', id: String(ev.id ?? '') },
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

async function calendarListEventsTool(_ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  if (!googleConfigured()) {
    return { ok: false, error: 'Google Calendar aún no está conectado.' }
  }
  try {
    const res = await gcalList(googleCalendarId()!, {
      timeMin: (args.time_min as string)?.trim() || undefined,
      timeMax: (args.time_max as string)?.trim() || undefined,
      max: typeof args.max === 'number' ? args.max : undefined,
    })
    return { ok: true, data: { kind: 'calendar', events: res.events, count: res.count } }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// =====================================================================
// SuiteCRM · ventas (Jeans Colombianos) — lectura, sin aprobación
// =====================================================================
// La lógica de fechas/rango (salesRange, periodWarning) y la extracción viven en
// _shared/suitecrm.ts (testeable sin las deps pesadas de este archivo).

const COP = (n: number) => (n < 0 ? '-$' : '$') + Math.round(Math.abs(n)).toLocaleString('es-CO')
const safeClient = (s: string) => (s || '').slice(0, 80) // dato no confiable: acotado

async function suitecrmSales(_ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const period = ((args.period as string) || 'yesterday').toLowerCase()
  let start: string, end: string, label: string
  // Rango explícito (MM/DD/YYYY) si el modelo lo provee; si no, lo derivamos del period.
  if (args.start_date && args.end_date) {
    start = String(args.start_date)
    end = String(args.end_date)
    label = `${start} – ${end}`
  } else {
    ;({ start, end, label } = salesRange(period))
  }

  try {
    const s = await getSales(start, end)
    const byDate: Record<string, { count: number; total: number }> = {}
    for (const inv of s.invoices) {
      const d = byDate[inv.invoice_date] ?? { count: 0, total: 0 }
      d.count++
      d.total += inv.total
      byDate[inv.invoice_date] = d
    }
    const warning = periodWarning(start, end)
    return {
      ok: true,
      data: {
        period: label,
        range: s.range,
        count: s.count,
        total: s.total,
        total_cop: COP(s.total),
        // Acotamos by_branch (defensa del recorte estructural + payload chico). Suelen
        // ser ~3 sucursales; tomar las 30 mayores cubre cualquier caso real.
        by_branch: s.by_branch.slice(0, 30).map((b) => ({ ...b, total_cop: COP(b.total) })),
        by_date: byDate,
        // Solo las 10 facturas más grandes para no inflar el contexto del modelo.
        top_invoices: s.invoices
          .slice()
          .sort((a, b) => b.total - a.total)
          .slice(0, 10)
          .map((i) => ({ number: i.number, client: safeClient(i.client), total: i.total, total_cop: COP(i.total), branch: i.branch, invoice_date: i.invoice_date })),
        ...(warning ? { warning } : {}),
      },
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// draft_document: crea un DOCUMENTO de trabajo editable (artefacto kind:'document' que el
// canvas abre en el editor estilo Notion). Sin side-effects — solo devuelve título + markdown.
async function draftDocument(_ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const title = (args.title as string)?.trim() || 'Documento'
  const content = String((args.content as string) ?? (args.markdown as string) ?? '')
  if (!content.trim()) return { ok: false, error: 'Falta el contenido (Markdown) del documento' }
  return { ok: true, data: { kind: 'document', title, markdown: content } }
}

// draft_slides: crea una PRESENTACIÓN editable (artefacto kind:'slides' que el canvas abre
// en el visor de diapositivas). Sin side-effects — solo normaliza y devuelve las diapositivas.
const SLIDE_LAYOUTS = new Set(['cover', 'bullets', 'statement', 'section', 'quote'])
async function draftSlides(_ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const title = (args.title as string)?.trim() || 'Presentación'
  const subtitle = typeof args.subtitle === 'string' ? args.subtitle.trim().slice(0, 240) : ''
  const rawSlides = Array.isArray(args.slides) ? args.slides : []
  if (!rawSlides.length) return { ok: false, error: 'Faltan las diapositivas (slides)' }
  const slides = rawSlides
    .slice(0, 40) // tope defensivo: un mazo no debería exceder 40 diapositivas
    .map((s) => {
      const o = (s ?? {}) as Record<string, unknown>
      const layout = typeof o.layout === 'string' && SLIDE_LAYOUTS.has(o.layout) ? o.layout : 'bullets'
      const heading = typeof o.heading === 'string' ? o.heading.slice(0, 200) : ''
      const body = typeof o.body === 'string' ? o.body.slice(0, 1200) : ''
      const note = typeof o.note === 'string' ? o.note.slice(0, 600) : ''
      const bullets = Array.isArray(o.bullets)
        ? o.bullets.filter((b) => typeof b === 'string').slice(0, 12).map((b) => (b as string).slice(0, 300))
        : []
      return { layout, heading, body, note, bullets }
    })
    .filter((s) => s.heading || s.body || s.bullets.length) // descarta diapositivas vacías
  if (!slides.length) return { ok: false, error: 'Las diapositivas vienen sin contenido' }
  return { ok: true, data: { kind: 'slides', title, subtitle, slides } }
}

// draft_sheet: crea una HOJA DE CÁLCULO editable (artefacto kind:'sheet' que el canvas abre en
// la grilla). Sin side-effects — normaliza columnas/filas y alinea cada fila a las columnas.
async function draftSheet(_ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const title = (args.title as string)?.trim() || 'Hoja de cálculo'
  const rawCols = Array.isArray(args.columns) ? args.columns : []
  const columns = rawCols
    .filter((c) => typeof c === 'string' || typeof c === 'number')
    .slice(0, 30) // tope defensivo de columnas
    .map((c) => String(c).slice(0, 80))
  if (!columns.length) return { ok: false, error: 'Faltan las columnas (columns)' }
  const rawRows = Array.isArray(args.rows) ? args.rows : []
  const rows = rawRows
    .slice(0, 500) // tope defensivo de filas
    .map((r) => {
      const cells = Array.isArray(r) ? r : [r]
      // Alinea cada fila a la cantidad de columnas (rellena vacíos, recorta excedente).
      return Array.from({ length: columns.length }, (_, i) => {
        const v = cells[i]
        return v == null ? '' : String(v).slice(0, 500)
      })
    })
  return { ok: true, data: { kind: 'sheet', title, columns, rows } }
}

// draft_board: crea una PIZARRA editable (artefacto kind:'board'). Sin side-effects — normaliza
// notas (ids únicos, color válido) y descarta conexiones que apunten a ids inexistentes.
const BOARD_COLORS = new Set(['slate', 'amber', 'sky', 'emerald', 'rose', 'violet'])
async function draftBoard(_ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const title = (args.title as string)?.trim() || 'Pizarra'
  const rawNodes = Array.isArray(args.nodes) ? args.nodes : []
  if (!rawNodes.length) return { ok: false, error: 'Faltan las notas (nodes)' }
  const seen = new Set<string>()
  const nodes = rawNodes
    .slice(0, 40) // tope defensivo
    .map((n, i) => {
      const o = (n ?? {}) as Record<string, unknown>
      let id = typeof o.id === 'string' && o.id.trim() ? o.id.trim().slice(0, 60) : ''
      if (!id || seen.has(id)) id = `n${i + 1}`
      while (seen.has(id)) id = `${id}_` // garantiza unicidad
      seen.add(id)
      const text = typeof o.text === 'string' ? o.text.slice(0, 240) : ''
      const color = typeof o.color === 'string' && BOARD_COLORS.has(o.color) ? o.color : 'slate'
      const x = typeof o.x === 'number' && Number.isFinite(o.x) ? o.x : undefined
      const y = typeof o.y === 'number' && Number.isFinite(o.y) ? o.y : undefined
      return { id, text, color, ...(x != null ? { x } : {}), ...(y != null ? { y } : {}) }
    })
    .filter((n) => n.text) // descarta notas vacías
  if (!nodes.length) return { ok: false, error: 'Las notas vienen sin texto' }
  const ids = new Set(nodes.map((n) => n.id))
  const rawEdges = Array.isArray(args.edges) ? args.edges : []
  const edges = rawEdges
    .slice(0, 80)
    .map((e) => (e ?? {}) as Record<string, unknown>)
    .filter((e) => typeof e.from === 'string' && typeof e.to === 'string' && ids.has(e.from) && ids.has(e.to) && e.from !== e.to)
    .map((e) => ({ from: e.from as string, to: e.to as string, ...(typeof e.label === 'string' && e.label ? { label: (e.label as string).slice(0, 80) } : {}) }))
  return { ok: true, data: { kind: 'board', title, nodes, edges } }
}

const HANDLERS: Record<string, (ctx: ToolContext, args: Record<string, unknown>) => Promise<ToolResult>> = {
  delegate_task: delegateTask,
  request_approval: requestApproval,
  save_memory: saveMemory,
  search_memory: searchMemory,
  finish_task: finishTask,
  escalate_to_ceo: escalateToCeo,
  read_kpis: readKpis,
  shopify_search_products: shopifySearchProducts,
  shopify_recent_orders: shopifyRecentOrders,
  shopify_search_customers: shopifySearchCustomers,
  shopify_shop_summary: shopifyShopSummary,
  shopify_get_inventory: shopifyGetInventory,
  shopify_adjust_inventory: shopifyAdjustInventoryHandler,
  generate_image: generateImage,
  web_search: webSearch,
  query_brain: queryBrain,
  ingest_document: ingestDocumentTool,
  create_agent: createAgentTool,
  send_email: sendEmail,
  compose_email: composeEmail,
  ask_questions: askQuestions,
  calendar_create_event: calendarCreateEventTool,
  calendar_list_events: calendarListEventsTool,
  suitecrm_sales: suitecrmSales,
  draft_document: draftDocument,
  draft_slides: draftSlides,
  draft_sheet: draftSheet,
  draft_board: draftBoard,
}

// =====================================================================
// Registry de tools (Fase 1.5) — CÓDIGO = fuente de verdad
// =====================================================================
// Combina los SCHEMAS versionados (TOOL_SPECS, generados desde tools_registry)
// con los HANDLERS de este archivo. Dos guards anti-drift se evalúan al cargar
// el módulo: un spec sin handler, o un handler sin spec, FALLA ruidosamente —
// imposible desincronizar registro y ejecución (el bug que motivó tool-kit.ts).
export const toolRegistry = new ToolRegistry(
  TOOL_SPECS.map((s) => {
    const handler = HANDLERS[s.name]
    if (!handler) throw new Error(`tool-registry: spec "${s.name}" sin handler en HANDLERS`)
    return defineTool({
      name: s.name,
      description: s.description,
      category: s.category,
      parameters: s.parameters,
      requiresApproval: s.requiresApproval,
      isActive: s.isActive,
      handler,
    })
  }),
)

for (const name of Object.keys(HANDLERS)) {
  if (!toolRegistry.get(name)) {
    throw new Error(`tool-registry: handler "${name}" sin spec en TOOL_SPECS`)
  }
}
