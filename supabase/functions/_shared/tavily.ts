// Wrapper de Tavily Search API — búsqueda web optimizada para LLMs.
// Free tier: 1000 búsquedas/mes. Obtén la key en https://app.tavily.com
//
// Lo que la hace especial: el endpoint /search devuelve además de los
// resultados orgánicos, un campo `answer` con un resumen sintetizado por su
// motor, lo cual ahorra tokens al modelo (no tiene que leer 5 páginas para
// armar una conclusión).

const TAVILY_ENDPOINT = 'https://api.tavily.com/search'

export interface TavilyResultItem {
  title: string
  url: string
  content: string
  score: number
  published_date?: string
}

export interface TavilyResponse {
  answer?: string
  query: string
  results: TavilyResultItem[]
  response_time?: number
}

export async function tavilySearch(
  query: string,
  options: {
    maxResults?: number
    depth?: 'basic' | 'advanced'
    topic?: 'general' | 'news'
    includeDomains?: string[]
    excludeDomains?: string[]
  } = {},
): Promise<TavilyResponse> {
  const apiKey = Deno.env.get('TAVILY_API_KEY')
  if (!apiKey) {
    throw new Error(
      'Tavily no está configurado. Obtén una API key gratis (1000 búsquedas/mes) en https://app.tavily.com y agrégala como secret TAVILY_API_KEY en Supabase.',
    )
  }
  const resp = await fetch(TAVILY_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: options.depth ?? 'basic',
      topic: options.topic ?? 'general',
      include_answer: true,
      include_images: false,
      max_results: Math.min(options.maxResults ?? 5, 10),
      include_domains: options.includeDomains,
      exclude_domains: options.excludeDomains,
    }),
  })
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    if (resp.status === 401) {
      throw new Error('Tavily 401: API key inválida. Revisa TAVILY_API_KEY en los secrets.')
    }
    if (resp.status === 429) {
      throw new Error('Tavily 429: límite mensual de búsquedas alcanzado. Espera al próximo mes o haz upgrade.')
    }
    throw new Error(`Tavily ${resp.status}: ${text.slice(0, 200)}`)
  }
  return (await resp.json()) as TavilyResponse
}
