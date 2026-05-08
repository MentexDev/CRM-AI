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
