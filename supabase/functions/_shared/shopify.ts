// Wrapper de la Admin API de Shopify (GraphQL).
// Lee credenciales desde el entorno de la Edge Function — Brandon configura
// los secrets en el dashboard de Supabase: SHOPIFY_STORE_DOMAIN, SHOPIFY_ACCESS_TOKEN.
//
// Las tools que llaman este wrapper devuelven payloads compactos al modelo
// (no el blob completo) para no quemar tokens.

const API_VERSION = '2024-10'

export interface ShopifyResult<T> {
  data: T
}

export async function shopifyGraphQL<T = Record<string, unknown>>(
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const domain = Deno.env.get('SHOPIFY_STORE_DOMAIN')
  const token = Deno.env.get('SHOPIFY_ACCESS_TOKEN')
  if (!domain || !token) {
    throw new Error(
      'Shopify no está configurado: SHOPIFY_STORE_DOMAIN y SHOPIFY_ACCESS_TOKEN deben estar en los secrets',
    )
  }

  const url = `https://${domain}/admin/api/${API_VERSION}/graphql.json`
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: JSON.stringify({ query, variables }),
  })

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`Shopify HTTP ${resp.status}: ${text.slice(0, 200)}`)
  }

  const json = (await resp.json()) as { data?: T; errors?: unknown }
  if (json.errors) {
    throw new Error(`Shopify GraphQL: ${JSON.stringify(json.errors).slice(0, 300)}`)
  }
  if (!json.data) {
    throw new Error('Shopify GraphQL devolvió sin datos')
  }
  return json.data
}

// Convierte gid://shopify/Product/12345 → "12345" para que el modelo no se
// confunda con el formato GraphQL de IDs.
export function stripGid(gid: string | null | undefined): string {
  if (!gid) return ''
  const idx = gid.lastIndexOf('/')
  return idx === -1 ? gid : gid.slice(idx + 1)
}

// Construye un gid de Shopify a partir de un id pelado y el tipo.
export function toGid(type: string, id: string): string {
  if (id.startsWith('gid://')) return id
  return `gid://shopify/${type}/${id}`
}

// =====================================================================
// Inventario
// =====================================================================

export interface InventoryLevel {
  location_id: string
  location_name: string
  available: number
  inventory_item_id: string
}

/**
 * Devuelve los niveles de inventario del SKU dado en TODAS las locations
 * activas. Sirve tanto al agente para leer stock como al execute-approval
 * para calcular el delta real antes de mutar.
 */
export async function shopifyGetInventoryBySku(sku: string): Promise<InventoryLevel[]> {
  const data = await shopifyGraphQL<{
    productVariants: {
      edges: Array<{
        node: {
          sku: string
          inventoryItem: {
            id: string
            inventoryLevels: {
              edges: Array<{
                node: {
                  quantities: Array<{ name: string; quantity: number }>
                  location: { id: string; name: string }
                }
              }>
            }
          }
        }
      }>
    }
  }>(
    `query Inventory($q: String!) {
      productVariants(first: 1, query: $q) {
        edges {
          node {
            sku
            inventoryItem {
              id
              inventoryLevels(first: 25) {
                edges {
                  node {
                    quantities(names: ["available"]) { name quantity }
                    location { id name }
                  }
                }
              }
            }
          }
        }
      }
    }`,
    { q: `sku:${sku}` },
  )

  const variant = data.productVariants.edges[0]?.node
  if (!variant) {
    throw new Error(`SKU no encontrado: ${sku}`)
  }
  const itemId = variant.inventoryItem.id
  return variant.inventoryItem.inventoryLevels.edges.map(({ node }) => ({
    location_id: stripGid(node.location.id),
    location_name: node.location.name,
    available: node.quantities.find((q) => q.name === 'available')?.quantity ?? 0,
    inventory_item_id: itemId,
  }))
}

/**
 * Ajusta el inventario de un SKU en una location específica con un delta
 * relativo (positivo o negativo). Devuelve el nuevo total disponible.
 *
 * Usa la mutation inventoryAdjustQuantities con name="available".
 */
export async function shopifyAdjustInventory(
  sku: string,
  locationId: string,
  delta: number,
  reason: string = 'correction',
): Promise<{ available: number; location_id: string; sku: string }> {
  // 1. Resolver el inventoryItemId del SKU
  const levels = await shopifyGetInventoryBySku(sku)
  const target = levels.find((l) => l.location_id === locationId)
  if (!target) {
    throw new Error(
      `SKU ${sku} no tiene inventario en la location ${locationId}. Locations con inventario: ${levels.map((l) => l.location_id).join(', ')}`,
    )
  }
  const itemGid = target.inventory_item_id

  // 2. Ejecutar el adjust
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
    {
      input: {
        reason,
        name: 'available',
        changes: [{ delta, inventoryItemId: itemGid, locationId: toGid('Location', locationId) }],
      },
    },
  )

  const errors = result.inventoryAdjustQuantities.userErrors
  if (errors.length > 0) {
    throw new Error(`Shopify userErrors: ${errors.map((e) => e.message).join('; ')}`)
  }

  const change = result.inventoryAdjustQuantities.inventoryAdjustmentGroup?.changes?.[0]
  return {
    sku,
    location_id: locationId,
    available: change?.quantityAfterChange ?? target.available + delta,
  }
}
