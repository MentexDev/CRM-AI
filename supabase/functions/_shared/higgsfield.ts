// Wrapper de la API de Higgsfield (text-to-image, modelo Flux Pro Max).
// Endpoint y formato de auth basados en el README oficial del SDK v2 de
// higgsfield-js (https://github.com/higgsfield-ai/higgsfield-js).
//
// CRÍTICO: el server bloquea requests sin el User-Agent del SDK
// (`higgsfield-server-js/2.0`) — devuelve 401 "Invalid credentials"
// aunque las keys sean correctas. Es una protección anti-browser.

const BASE_URL = 'https://platform.higgsfield.ai'
const T2I_ENDPOINT = '/flux-pro/kontext/max/text-to-image'
const USER_AGENT = 'higgsfield-server-js/2.0'

const POLL_INTERVAL_MS = 2000
const POLL_MAX_ATTEMPTS = 30 // 60s total

function authHeaders() {
  const id = Deno.env.get('HIGGSFIELD_API_KEY')
  const secret = Deno.env.get('HIGGSFIELD_API_SECRET')
  if (!id || !secret) {
    throw new Error(
      'Higgsfield no está configurado: HIGGSFIELD_API_KEY y HIGGSFIELD_API_SECRET deben estar en los secrets',
    )
  }
  return {
    Authorization: `Key ${id}:${secret}`,
    'Content-Type': 'application/json',
    'User-Agent': USER_AGENT,
  }
}

interface SubmitResponse {
  request_id?: string
  id?: string
  status_url?: string
}

interface StatusResponse {
  status: 'queued' | 'in_progress' | 'completed' | 'failed' | 'cancelled' | 'nsfw' | string
  request_id?: string
  images?: Array<{ url: string }>
  video?: { url: string }
  result?: { images?: Array<{ url: string }> }
  output?: { images?: Array<{ url: string }> }
  error?: string | { message?: string }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Genera una o varias imágenes con Higgsfield (Flux Pro Max). Devuelve
 * URLs públicas (las hospeda Higgsfield; el front las muestra directo).
 */
export async function higgsfieldGenerateImage(
  prompt: string,
  aspectRatio: string = '1:1',
  styleHint?: string,
): Promise<string[]> {
  const headers = authHeaders()

  const enrichedPrompt = styleHint ? `${prompt}\n\nStyle: ${styleHint}` : prompt

  const submitResp = await fetch(`${BASE_URL}${T2I_ENDPOINT}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      input: {
        prompt: enrichedPrompt,
        aspect_ratio: aspectRatio,
        safety_tolerance: 2,
      },
    }),
  })

  if (!submitResp.ok) {
    const text = await submitResp.text().catch(() => '')
    throw new Error(`Higgsfield submit ${submitResp.status}: ${text.slice(0, 200)}`)
  }

  const submitJson = (await submitResp.json()) as SubmitResponse
  const requestId = submitJson.request_id ?? submitJson.id
  if (!requestId) {
    throw new Error(
      `Higgsfield no devolvió request_id: ${JSON.stringify(submitJson).slice(0, 200)}`,
    )
  }

  for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
    await sleep(POLL_INTERVAL_MS)
    const statusResp = await fetch(`${BASE_URL}/requests/${requestId}/status`, {
      method: 'GET',
      headers,
    })
    if (!statusResp.ok) {
      const text = await statusResp.text().catch(() => '')
      throw new Error(`Higgsfield status ${statusResp.status}: ${text.slice(0, 200)}`)
    }
    const data = (await statusResp.json()) as StatusResponse

    if (data.status === 'completed') {
      // El array de imágenes puede venir en `images` directo o anidado
      // según el modelo. Buscamos en ambos lados por compatibilidad.
      const images =
        data.images ??
        data.result?.images ??
        data.output?.images ??
        []
      const urls = images.map((img) => img?.url).filter((u): u is string => Boolean(u))
      if (urls.length === 0) {
        throw new Error('Higgsfield completó sin imágenes en la respuesta')
      }
      return urls
    }
    if (data.status === 'nsfw') {
      throw new Error('Higgsfield rechazó el prompt por seguridad (NSFW). Reformula el prompt.')
    }
    if (data.status === 'failed' || data.status === 'cancelled') {
      const errMsg =
        typeof data.error === 'string'
          ? data.error
          : data.error?.message ?? 'sin detalle'
      throw new Error(`Higgsfield ${data.status}: ${errMsg}`)
    }
    // queued / in_progress → seguir polleando
  }

  throw new Error(
    `Higgsfield timeout: ${(POLL_INTERVAL_MS * POLL_MAX_ATTEMPTS) / 1000}s sin completar`,
  )
}
