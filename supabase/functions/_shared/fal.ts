// Wrapper de fal.ai (https://fal.ai) — generación de imágenes con modelos Flux (y SDXL).
// API por COLA (queue): submit → poll status → fetch result. Auth: header `Authorization: Key <FAL_KEY>`.
// La imagen resultante (URL en el CDN de fal, que puede expirar) se RE-SUBE a Supabase Storage
// (bucket público `agent-images`) para tener una URL estable y propia — igual que hace Gemini.
//
// Secret requerido: FAL_KEY (de https://fal.ai/dashboard/keys). Formato `id:secret` o token único;
// va literal en el header. NUNCA se expone al frontend.
import { adminDb } from './db.ts'
import { isBlockedHost } from './netguard.ts'

const QUEUE_BASE = 'https://queue.fal.run'
const BUCKET = 'agent-images'
const POLL_INTERVAL_MS = 2000
// 80s de poll. Headroom bajo el límite (~150s) de la Edge Function, dejando espacio para
// submit + result + mirror. Corre SÍNCRONO dentro del turno del agente (chat-with-agent buferiza
// una sola respuesta, sin streaming): si modelos pesados (flux-pro/ultra) en cola larga no
// alcanzan, el siguiente paso es generación en background (EdgeRuntime.waitUntil) + persistir async.
const POLL_MAX_ATTEMPTS = 40
const FETCH_TIMEOUT_MS = 15_000 // cota por request (submit/status/result/mirror): evita apilar latencia sin límite
const MAX_IMAGE_BYTES = 20 * 1024 * 1024 // 20 MB — tope al espejar a Storage

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function authHeaders() {
  const key = Deno.env.get('FAL_KEY')
  if (!key) throw new Error('fal.ai no está configurado: FAL_KEY debe estar en los secrets')
  return { Authorization: `Key ${key}`, 'Content-Type': 'application/json' }
}

// Modelos que toman `image_size` {width,height} (la mayoría de Flux/SDXL).
function aspectToSize(aspectRatio: string): { width: number; height: number } {
  switch (aspectRatio) {
    case '16:9':
      return { width: 1344, height: 768 }
    case '9:16':
      return { width: 768, height: 1344 }
    case '4:5':
      return { width: 1024, height: 1280 }
    case '3:2':
      return { width: 1216, height: 832 }
    case '1:1':
    default:
      return { width: 1024, height: 1024 }
  }
}

// Modelos como flux-pro/v1.1-ultra toman `aspect_ratio` (string) en vez de image_size.
// Mapeamos nuestros 5 ratios a los soportados por Ultra (4:5 → 3:4, el más cercano).
function aspectForRatioModels(aspectRatio: string): string {
  switch (aspectRatio) {
    case '16:9':
      return '16:9'
    case '9:16':
      return '9:16'
    case '3:2':
      return '3:2'
    case '4:5':
      return '3:4'
    case '1:1':
    default:
      return '1:1'
  }
}

interface FalImage {
  url?: string
  content_type?: string
}
interface FalResult {
  images?: FalImage[]
  image?: FalImage
  output?: { images?: FalImage[] }
}

/**
 * Genera una imagen con fal.ai. `modelId` es el path del modelo (p.ej. 'fal-ai/flux/schnell').
 * `usesAspectRatio` = true para modelos que toman aspect_ratio en lugar de image_size.
 * Devuelve URLs públicas (re-subidas a Storage; si la re-subida falla, la URL remota de fal).
 */
export async function falGenerateImage(
  modelId: string,
  prompt: string,
  aspectRatio: string = '1:1',
  styleHint?: string,
  opts: { usesAspectRatio?: boolean } = {},
): Promise<string[]> {
  const headers = authHeaders()
  const fullPrompt = styleHint ? `${prompt}. Style: ${styleHint}.` : prompt

  const body: Record<string, unknown> = { prompt: fullPrompt, num_images: 1 }
  if (opts.usesAspectRatio) body.aspect_ratio = aspectForRatioModels(aspectRatio)
  else body.image_size = aspectToSize(aspectRatio)

  // 1) Submit a la cola
  const submitResp = await fetch(`${QUEUE_BASE}/${modelId}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!submitResp.ok) {
    const text = await submitResp.text().catch(() => '')
    if (submitResp.status === 401 || submitResp.status === 403) {
      throw new Error('fal.ai 401/403: FAL_KEY inválida o sin permisos. Revisa el secret FAL_KEY.')
    }
    if (submitResp.status === 402) {
      throw new Error('fal.ai sin saldo: recarga en https://fal.ai/dashboard/billing')
    }
    if (submitResp.status === 404) {
      throw new Error(`fal.ai 404: el modelo "${modelId}" no existe o cambió de nombre.`)
    }
    throw new Error(`fal.ai submit ${submitResp.status}: ${text.slice(0, 200)}`)
  }
  const submit = (await submitResp.json().catch(() => ({}))) as {
    request_id?: string
    status_url?: string
    response_url?: string
  }
  const requestId = submit.request_id
  const statusUrl = submit.status_url ?? (requestId ? `${QUEUE_BASE}/${modelId}/requests/${requestId}/status` : null)
  const responseUrl = submit.response_url ?? (requestId ? `${QUEUE_BASE}/${modelId}/requests/${requestId}` : null)
  if (!statusUrl || !responseUrl) {
    throw new Error(`fal.ai no devolvió request_id: ${JSON.stringify(submit).slice(0, 200)}`)
  }

  // 2) Poll del estado (status en MAYÚSCULAS: IN_QUEUE / IN_PROGRESS / COMPLETED)
  for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
    await sleep(POLL_INTERVAL_MS)
    const sResp = await fetch(statusUrl, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!sResp.ok) {
      if (sResp.status === 404 || sResp.status === 202) continue // transitorio → seguir
      const text = await sResp.text().catch(() => '')
      throw new Error(`fal.ai status ${sResp.status}: ${text.slice(0, 160)}`)
    }
    const s = (await sResp.json().catch(() => ({}))) as { status?: string }
    const st = String(s.status ?? '').toUpperCase()
    if (st === 'COMPLETED' || st === 'OK') break
    if (st === 'ERROR' || st === 'FAILED' || st === 'CANCELLED') {
      throw new Error(`fal.ai ${st}: ${JSON.stringify(s).slice(0, 160)}`)
    }
    if (i === POLL_MAX_ATTEMPTS - 1) {
      throw new Error(`fal.ai timeout: ${(POLL_INTERVAL_MS * POLL_MAX_ATTEMPTS) / 1000}s sin completar`)
    }
    // IN_QUEUE / IN_PROGRESS → seguir polleando
  }

  // 3) Resultado
  const rResp = await fetch(responseUrl, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!rResp.ok) {
    const text = await rResp.text().catch(() => '')
    throw new Error(`fal.ai result ${rResp.status}: ${text.slice(0, 160)}`)
  }
  const result = (await rResp.json().catch(() => ({}))) as FalResult
  const imgs = result.images ?? result.output?.images ?? (result.image ? [result.image] : [])
  const remoteUrls = imgs.map((im) => im?.url).filter((u): u is string => Boolean(u))
  if (remoteUrls.length === 0) {
    throw new Error('fal.ai completó sin imágenes en la respuesta')
  }

  // 4) Re-subir a Storage para URL estable propia. Si falla, devolver la URL remota de fal.
  const stable: string[] = []
  for (const u of remoteUrls) {
    try {
      stable.push(await mirrorToStorage(u))
    } catch (e) {
      console.warn('[fal] mirror a Storage falló, uso URL remota:', e instanceof Error ? e.message : e)
      stable.push(u)
    }
  }
  return stable
}

// Descarga la imagen del CDN de fal y la sube al bucket público; devuelve la URL pública propia.
async function mirrorToStorage(remoteUrl: string): Promise<string> {
  // Anti-SSRF (defensa-en-profundidad): aunque remoteUrl viene de la respuesta autenticada de fal,
  // exigimos https + host público y revalidamos el destino final tras posibles redirects, con tope
  // de tamaño — coherente con fetchReferenceImage de geminiImage.ts.
  const u = new URL(remoteUrl)
  if (u.protocol !== 'https:' || isBlockedHost(u.hostname)) throw new Error('mirror: URL no permitida')
  const r = await fetch(u, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: 'follow' })
  if (!r.ok) throw new Error(`fetch ${r.status}`)
  const fin = new URL(r.url) // destino real tras redirects
  if (fin.protocol !== 'https:' || isBlockedHost(fin.hostname)) throw new Error('mirror: redirect no permitido')
  const declared = Number(r.headers.get('content-length') || 0)
  if (declared && declared > MAX_IMAGE_BYTES) throw new Error('mirror: imagen demasiado grande')
  const mime = (r.headers.get('content-type') || 'image/png').split(';')[0].trim().toLowerCase()
  const ext = mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : mime.includes('webp') ? 'webp' : 'png'
  const bytes = new Uint8Array(await r.arrayBuffer())
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error('mirror: imagen demasiado grande')
  const path = `fal/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const db = adminDb()
  const { error } = await db.storage.from(BUCKET).upload(path, bytes, { contentType: mime, upsert: true })
  if (error) throw new Error(`Storage upload: ${error.message}`)
  return db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
}
