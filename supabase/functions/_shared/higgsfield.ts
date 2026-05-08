// Wrapper de la API de Higgsfield (text-to-image, modelo Soul).
// Auth: Authorization: Key {API_KEY_ID}:{API_KEY_SECRET}
//
// Higgsfield es asíncrono: submit devuelve un request_id, después se
// consulta el status hasta que esté `completed` y se obtiene la URL.
// Generaciones típicas: 5-30s. Timeout duro: 60s para no exceder el
// límite de la Edge Function.

const BASE_URL = 'https://platform.higgsfield.ai'

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
  }
}

interface SubmitResponse {
  request_id?: string
  id?: string
}

interface StatusResponse {
  status: 'queued' | 'in_progress' | 'completed' | 'failed' | 'cancelled' | string
  images?: Array<{ url: string }>
  result?: { images?: Array<{ url: string }> }
  output?: { images?: Array<{ url: string }> }
  error?: string | { message?: string }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Genera una o varias imágenes con Higgsfield Soul. Devuelve URLs públicas
 * (las hospeda Higgsfield; el front las puede mostrar directamente).
 */
export async function higgsfieldGenerateImage(
  prompt: string,
  aspectRatio: string = '1:1',
  styleHint?: string,
): Promise<string[]> {
  const headers = authHeaders()

  const enrichedPrompt = styleHint ? `${prompt}\n\nStyle: ${styleHint}` : prompt

  const submitResp = await fetch(`${BASE_URL}/v1/text2image/soul`, {
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
      // El array de imágenes puede venir en distintos lugares según el modelo.
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
