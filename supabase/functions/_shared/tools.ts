// Tools core ejecutables por los agentes.
// Cada handler recibe (ctx, args) y devuelve un ToolResult serializable a JSON.
// El runtime persiste cada invocación en `tool_calls` y el resultado se
// reinyecta al modelo como mensaje role='tool' en la siguiente iteración.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@^2'
import type { ToolCallRequest, ToolDefinition } from './llm.ts'
import { adminDb } from './db.ts'
import { shopifyGraphQL, stripGid } from './shopify.ts'

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
  let args: Record<string, unknown>
  try {
    args = call.function.arguments ? JSON.parse(call.function.arguments) : {}
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
  const limit = Math.min((args.limit as number) || 10, 50)
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

async function shopifyRecentOrders(
  _ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const limit = Math.min((args.limit as number) || 20, 50)
  const status = (args.status as string) || ''
  // Query Shopify uses syntax like "financial_status:paid created_at:>2024-01-01"
  let q = ''
  if (status) q += `financial_status:${status} `
  if (args.since) q += `created_at:>='${args.since}' `

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
      data: { orders, count: orders.length, filters: { status, since: args.since ?? null } },
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
  const limit = Math.min((args.limit as number) || 10, 50)
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
}
