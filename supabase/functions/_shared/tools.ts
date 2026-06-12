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
}

export interface ToolResult {
  ok: boolean
  data?: unknown
  error?: string
  side_effect?: { kind: string; id: string }
}

// Tope de tamaño del resultado de una tool al REINYECTARLO al contexto del LLM.
// El resultado completo se guarda íntegro en la tabla `tool_calls` (para la UI y
// la auditoría); al modelo solo le pasamos una versión acotada para no reventar
// el límite de tokens del proveedor (p. ej. Groq free tier = 12k tokens/min).
// Solo recortamos el CONTENIDO del mensaje role='tool'; nunca quitamos el
// mensaje, así el emparejamiento tool_call↔tool_result queda intacto.
const TOOL_RESULT_MAX_CHARS = 5000

export function capToolResultForContext(result: unknown, maxChars = TOOL_RESULT_MAX_CHARS): string {
  let s: string
  try {
    s = JSON.stringify(result)
  } catch {
    s = String(result)
  }
  if (s.length <= maxChars) return s
  const omitted = s.length - maxChars
  return (
    s.slice(0, maxChars) +
    `\n\n…[resultado recortado: se omiten ${omitted} de ${s.length} caracteres para no exceder el límite de tokens del proveedor. ` +
    `Si necesitas más detalle, repite la consulta con un 'limit' menor o un filtro más específico.]`
  )
}

export async function loadTools(names: string[]): Promise<ToolDescriptor[]> {
  if (!names || names.length === 0) return []
  const db = adminDb()
  const { data, error } = await db
    .from('tools_registry')
    .select('*')
    .in('name', names)
    .eq('is_active', true)
  if (error) throw error
  return (data ?? []) as ToolDescriptor[]
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

export async function runTool(
  ctx: ToolContext,
  call: ToolCallRequest,
): Promise<ToolResult> {
  const handler = HANDLERS[call.function.name]
  if (!handler) {
    return { ok: false, error: `Tool no implementada en runtime: ${call.function.name}` }
  }
  // Defensa: el LLM ocasionalmente manda `"null"` o `"undefined"` cuando no
  // hay argumentos. JSON.parse('null') devuelve null, lo cual rompe cualquier
  // handler que haga `args.foo`. Forzamos a un objeto vacío en esos casos.
  let args: Record<string, unknown>
  try {
    const raw = call.function.arguments
    const parsed = raw ? JSON.parse(raw) : {}
    args = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return { ok: false, error: 'Argumentos JSON inválidos' }
  }
  try {
    return await handler(ctx, args)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
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

  return {
    ok: true,
    data: { task_id: task.id, assigned_to: agentSlug },
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
  if (!prompt) return { ok: false, error: 'Falta prompt' }
  try {
    const result = await generateImageMulti(prompt, aspectRatio, styleHint)
    return {
      ok: true,
      data: {
        images: result.urls.map((url) => ({ url })),
        prompt,
        aspect_ratio: aspectRatio,
        provider: result.provider,
      },
    }
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
}
