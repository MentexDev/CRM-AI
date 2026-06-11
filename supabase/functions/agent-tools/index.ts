// =====================================================================
// Edge Function: agent-tools
// Más capacidades del CRM para el motor agéntico externo (CrewAI), con los
// MISMOS guardrails que el CRM:
//
//   action: "get_inventory"    → stock por SKU en Shopify (lectura)
//   action: "adjust_inventory" → ajuste con UMBRAL: |delta|>20u crea aprobación
//                                y NO ejecuta; ≤20u ejecuta directo
//   action: "web_search"       → búsqueda web real con Tavily
//
// Autocontenida (inline de Shopify GraphQL + Tavily). Lee secrets del entorno:
// SHOPIFY_STORE_DOMAIN, SHOPIFY_ACCESS_TOKEN, TAVILY_API_KEY.
// =====================================================================
import { createClient } from 'jsr:@supabase/supabase-js@^2'
import { requireEngineKey } from '../_shared/auth.ts'

const SHOPIFY_API_VERSION = '2024-10'
const INVENTORY_UNIT_THRESHOLD = 20

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-engine-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// ─────────────────────────────── Shopify (inline) ───────────────────────────
async function shopifyGraphQL<T = Record<string, unknown>>(
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const domain = Deno.env.get('SHOPIFY_STORE_DOMAIN')
  const token = Deno.env.get('SHOPIFY_ACCESS_TOKEN')
  if (!domain || !token) {
    throw new Error('Shopify no configurado: faltan SHOPIFY_STORE_DOMAIN / SHOPIFY_ACCESS_TOKEN')
  }
  const url = `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query, variables }),
  })
  if (!resp.ok) throw new Error(`Shopify HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`)
  const json = (await resp.json()) as { data?: T; errors?: unknown }
  if (json.errors) throw new Error(`Shopify GraphQL: ${JSON.stringify(json.errors).slice(0, 300)}`)
  if (!json.data) throw new Error('Shopify GraphQL sin datos')
  return json.data
}

const stripGid = (gid?: string | null) => (!gid ? '' : gid.slice(gid.lastIndexOf('/') + 1))
const toGid = (type: string, id: string) => (id.startsWith('gid://') ? id : `gid://shopify/${type}/${id}`)

interface InventoryLevel {
  location_id: string
  location_name: string
  available: number
  inventory_item_id: string
}

async function getInventoryBySku(sku: string): Promise<InventoryLevel[]> {
  const data = await shopifyGraphQL<{
    productVariants: { edges: Array<{ node: {
      sku: string
      inventoryItem: { id: string; inventoryLevels: { edges: Array<{ node: {
        quantities: Array<{ name: string; quantity: number }>
        location: { id: string; name: string }
      } }> } }
    } }> }
  }>(
    `query Inventory($q: String!) {
      productVariants(first: 1, query: $q) {
        edges { node { sku inventoryItem { id inventoryLevels(first: 25) {
          edges { node { quantities(names: ["available"]) { name quantity } location { id name } } }
        } } } }
      }
    }`,
    { q: `sku:${sku}` },
  )
  const variant = data.productVariants.edges[0]?.node
  if (!variant) throw new Error(`SKU no encontrado: ${sku}`)
  const itemId = variant.inventoryItem.id
  return variant.inventoryItem.inventoryLevels.edges.map(({ node }) => ({
    location_id: stripGid(node.location.id),
    location_name: node.location.name,
    available: node.quantities.find((q) => q.name === 'available')?.quantity ?? 0,
    inventory_item_id: itemId,
  }))
}

async function adjustInventory(sku: string, locationId: string, delta: number, reason: string) {
  const levels = await getInventoryBySku(sku)
  const target = levels.find((l) => l.location_id === locationId)
  if (!target) {
    throw new Error(`SKU ${sku} sin inventario en location ${locationId}. Locations: ${levels.map((l) => l.location_id).join(', ')}`)
  }
  const result = await shopifyGraphQL<{
    inventoryAdjustQuantities: {
      inventoryAdjustmentGroup: { changes: Array<{ delta: number; quantityAfterChange: number }> } | null
      userErrors: Array<{ field: string[]; message: string }>
    }
  }>(
    `mutation Adjust($input: InventoryAdjustQuantitiesInput!) {
      inventoryAdjustQuantities(input: $input) {
        inventoryAdjustmentGroup { changes { delta quantityAfterChange } }
        userErrors { field message }
      }
    }`,
    { input: { reason, name: 'available', changes: [{ delta, inventoryItemId: target.inventory_item_id, locationId: toGid('Location', locationId) }] } },
  )
  const errs = result.inventoryAdjustQuantities.userErrors
  if (errs.length > 0) throw new Error(`Shopify userErrors: ${errs.map((e) => e.message).join('; ')}`)
  const change = result.inventoryAdjustQuantities.inventoryAdjustmentGroup?.changes?.[0]
  return { sku, location_id: locationId, available: change?.quantityAfterChange ?? target.available + delta }
}

// ─────────────────────────────── Tavily (inline) ────────────────────────────
async function tavilySearch(query: string, limit: number, depth: string, topic: string) {
  const apiKey = Deno.env.get('TAVILY_API_KEY')
  if (!apiKey) throw new Error('Tavily no configurado: falta TAVILY_API_KEY')
  const resp = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey, query, search_depth: depth, topic,
      include_answer: true, include_images: false, max_results: Math.min(limit, 10),
    }),
  })
  if (!resp.ok) {
    if (resp.status === 401) throw new Error('Tavily 401: API key inválida')
    if (resp.status === 429) throw new Error('Tavily 429: límite mensual alcanzado')
    throw new Error(`Tavily ${resp.status}: ${(await resp.text()).slice(0, 200)}`)
  }
  return await resp.json() as {
    answer?: string; query: string
    results: Array<{ title: string; url: string; content: string; score: number; published_date?: string }>
  }
}

// ─────────────────────────────── Handler ────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  // Auth máquina-a-máquina: exige X-Engine-Key (puede ejecutar ajustes reales en Shopify).
  const denied = requireEngineKey(req)
  if (denied) return denied

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Body JSON inválido' }, 400)
  }

  const action = (body.action as string | undefined)?.trim()
  try {
    if (action === 'web_search') {
      const query = (body.query as string | undefined)?.trim()
      if (!query) return json({ error: 'Falta query' }, 400)
      const r = await tavilySearch(
        query,
        (body.limit as number) || 5,
        (body.depth as string) || 'basic',
        (body.topic as string) || 'general',
      )
      return json({
        ok: true, action, query: r.query, answer: r.answer ?? null,
        results: r.results.map((x) => ({
          title: x.title, url: x.url,
          content: x.content.length > 500 ? x.content.slice(0, 500) + '…' : x.content,
          published_date: x.published_date ?? null, score: x.score,
        })),
        count: r.results.length,
      })
    }

    if (action === 'get_inventory') {
      const sku = (body.sku as string | undefined)?.trim()
      if (!sku) return json({ error: 'Falta sku' }, 400)
      const levels = await getInventoryBySku(sku)
      const total = levels.reduce((a, l) => a + l.available, 0)
      return json({ ok: true, action, sku, total_available: total, levels })
    }

    if (action === 'adjust_inventory') {
      const agentId = (body.agent_id as string | undefined)?.trim()
      const sku = (body.sku as string | undefined)?.trim()
      const locationId = (body.location_id as string | undefined)?.trim()
      const delta = Number(body.delta)
      const reason = (body.reason as string | undefined)?.trim() || 'correction'
      if (!agentId) return json({ error: 'Falta agent_id' }, 400)
      if (!sku) return json({ error: 'Falta sku' }, 400)
      if (!locationId) return json({ error: 'Falta location_id (úsalo de get_inventory)' }, 400)
      if (!delta || Number.isNaN(delta)) return json({ error: 'Falta delta numérico' }, 400)

      const supabaseUrl = Deno.env.get('SUPABASE_URL')
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
      if (!supabaseUrl || !serviceKey) return json({ error: 'Entorno no configurado' }, 500)
      const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

      const { data: agent } = await db.from('agents').select('id, brand_id').eq('id', agentId).maybeSingle()
      if (!agent) return json({ ok: false, error: 'Agente no encontrado' }, 404)

      const absDelta = Math.abs(delta)
      // UMBRAL: si supera 20u, crear aprobación y NO ejecutar (igual que el CRM).
      if (absDelta > INVENTORY_UNIT_THRESHOLD) {
        const summary = `Ajustar inventario SKU ${sku}: ${delta > 0 ? '+' : ''}${delta} u en location ${locationId} (razón: ${reason}). Supera el umbral de ${INVENTORY_UNIT_THRESHOLD}u — requiere aprobación.`
        // Idempotencia: reusar aprobación pendiente idéntica.
        const { data: existing } = await db.from('approvals')
          .select('id').eq('agent_id', agent.id).eq('summary', summary).eq('status', 'pending').maybeSingle()
        if (existing) {
          return json({ ok: false, action, requires_approval: true, approval_id: existing.id, deduped: true,
            error: `Supera el umbral de ${INVENTORY_UNIT_THRESHOLD}u. Aprobación ${existing.id} ya pendiente — NO repitas.` })
        }
        const { data: approval, error } = await db.from('approvals').insert({
          agent_id: agent.id, brand_id: agent.brand_id, trigger: 'inventory_threshold', summary,
          payload: { tool_name: 'shopify_adjust_inventory', args: { sku, location_id: locationId, delta, reason }, threshold: INVENTORY_UNIT_THRESHOLD },
          status: 'pending',
        }).select('id').single()
        if (error) return json({ ok: false, error: error.message }, 422)
        return json({ ok: false, action, requires_approval: true, approval_id: approval.id,
          error: `Cambio de ${absDelta}u supera el umbral de ${INVENTORY_UNIT_THRESHOLD}u. Creé la aprobación ${approval.id}. NO repitas — al aprobarse se ejecuta sola.` })
      }

      // Bajo umbral: ejecutar directo en Shopify.
      const result = await adjustInventory(sku, locationId, delta, reason)
      return json({ ok: true, action, ...result, delta_applied: delta, reason })
    }

    return json({ error: "action debe ser 'get_inventory', 'adjust_inventory' o 'web_search'" }, 400)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[agent-tools] Error:', message)
    return json({ ok: false, error: message }, 500)
  }
})

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS, 'content-type': 'application/json; charset=utf-8' },
  })
}
