// Multi-provider image generation.
// El handler `generate_image` llama a este módulo. La selección del provider
// se hace por env var IMAGE_PROVIDER (pollinations | higgsfield), o
// automáticamente: si hay créditos/keys de Higgsfield se usa ese; si no,
// fallback a Pollinations (gratis, sin auth).
import { higgsfieldGenerateImage } from './higgsfield.ts'
import { geminiGenerateImage } from './geminiImage.ts'
import { falGenerateImage } from './fal.ts'

export interface ImageGenResult {
  provider: string
  urls: string[]
  // Cuántas imágenes de referencia se APLICARON realmente (0 si el provider final no las
  // soporta o hubo fallback). NO es lo que se pidió — es lo que se usó. Ver tools.ts.
  referencesApplied: number
}

// Catálogo de modelos SELECCIONABLES por el usuario/agente (el arg `model` de la tool
// generate_image). La clave es lo que llega en el arg; mapea a provider + id real + flags.
// fal.* son de pago (fal.ai); nano-banana es Gemini (el único que EDITA con referencias).
export const IMAGE_MODELS: Record<
  string,
  { provider: 'fal' | 'gemini'; id: string; label: string; usesAspectRatio?: boolean }
> = {
  'flux-schnell': { provider: 'fal', id: 'fal-ai/flux/schnell', label: 'Flux Schnell' },
  'flux-dev': { provider: 'fal', id: 'fal-ai/flux/dev', label: 'Flux Dev' },
  'stable-xl': { provider: 'fal', id: 'fal-ai/fast-sdxl', label: 'Stable XL' },
  'flux-pro': { provider: 'fal', id: 'fal-ai/flux-pro/v1.1', label: 'Flux Pro' },
  'flux-ultra': { provider: 'fal', id: 'fal-ai/flux-pro/v1.1-ultra', label: 'Flux Ultra', usesAspectRatio: true },
  'nano-banana': { provider: 'gemini', id: 'gemini', label: 'Nano Banana (Gemini)' },
}

// Mapping de aspect ratios → dimensiones para providers que toman width/height.
function aspectToDims(aspectRatio: string): { width: number; height: number } {
  switch (aspectRatio) {
    case '16:9':
      return { width: 1280, height: 720 }
    case '9:16':
      return { width: 720, height: 1280 }
    case '4:5':
      return { width: 1024, height: 1280 }
    case '3:2':
      return { width: 1200, height: 800 }
    case '1:1':
    default:
      return { width: 1024, height: 1024 }
  }
}

// Pollinations.ai — gratis, sin auth, sin setup. La URL misma renderiza la
// imagen on-the-fly: el cliente la consume al cargar el src del <img>.
function pollinationsUrl(prompt: string, aspectRatio: string, styleHint?: string): string {
  const { width, height } = aspectToDims(aspectRatio)
  const fullPrompt = styleHint ? `${prompt}, ${styleHint}` : prompt
  const enc = encodeURIComponent(fullPrompt)
  // model=flux es el mejor de los gratuitos; nologo quita la marca de agua
  // y enhance mejora calidad. seed con timestamp para que cada generación
  // sea diferente.
  const seed = Date.now() % 1_000_000
  return `https://image.pollinations.ai/prompt/${enc}?width=${width}&height=${height}&model=flux&nologo=true&enhance=true&seed=${seed}`
}

async function pollinationsGenerate(
  prompt: string,
  aspectRatio: string,
  styleHint?: string,
): Promise<string[]> {
  // Pollinations no necesita esperar — la URL ES la imagen. El navegador la
  // resuelve cuando hace src=. Pero para asegurar que el generador la haya
  // cocinado, hacemos un HEAD request al final con timeout corto.
  const url = pollinationsUrl(prompt, aspectRatio, styleHint)
  return [url]
}

function pickProvider(referenceImageUrls?: string[], model?: string): string {
  // 1) Modelo ELEGIDO explícitamente (el usuario/agente lo pidió) → manda su provider.
  if (model && IMAGE_MODELS[model]) return IMAGE_MODELS[model].provider
  // 2) Sin modelo explícito → comportamiento automático (NO mete fal por defecto: es de pago).
  // Imágenes de referencia → solo Gemini las soporta; si hay key, gana sobre todo lo demás.
  if (referenceImageUrls?.length && Deno.env.get('GEMINI_API_KEY')) return 'gemini'
  const explicit = (Deno.env.get('IMAGE_PROVIDER') || '').trim().toLowerCase()
  if (explicit === 'pollinations' || explicit === 'higgsfield' || explicit === 'gemini' || explicit === 'fal') return explicit
  // Auto (por calidad): Gemini "Nano Banana" si hay key → Higgsfield → Pollinations.
  if (Deno.env.get('GEMINI_API_KEY')) return 'gemini'
  if (Deno.env.get('HIGGSFIELD_API_KEY') && Deno.env.get('HIGGSFIELD_API_SECRET')) {
    return 'higgsfield'
  }
  return 'pollinations'
}

export async function generateImage(
  prompt: string,
  aspectRatio: string = '1:1',
  styleHint?: string,
  referenceImageUrls?: string[],
  model?: string,
): Promise<ImageGenResult> {
  const provider = pickProvider(referenceImageUrls, model)

  if (provider === 'fal') {
    // Modelo fal: el elegido (si es un modelo fal válido), o flux-dev por defecto (equilibrado).
    const key = model && IMAGE_MODELS[model]?.provider === 'fal' ? model : 'flux-dev'
    const m = IMAGE_MODELS[key]
    // SIN fallback silencioso: el usuario eligió este modelo (de pago). Si fal falla, el error
    // sube y el agente se lo comunica con transparencia (no entregamos una imagen que no pidió).
    const urls = await falGenerateImage(m.id, prompt, aspectRatio, styleHint, { usesAspectRatio: m.usesAspectRatio })
    return { provider: `fal · ${m.label}`, urls, referencesApplied: 0 }
  }

  if (provider === 'gemini') {
    try {
      const urls = await geminiGenerateImage(prompt, aspectRatio, styleHint, referenceImageUrls)
      return {
        provider: `gemini (${Deno.env.get('GEMINI_IMAGE_MODEL') || 'gemini-3-pro-image'})`,
        urls,
        referencesApplied: referenceImageUrls?.length ?? 0,
      }
    } catch (e) {
      // Si Gemini falla (key, cuota, formato), no bloqueamos: caemos a Pollinations.
      // OJO: Pollinations NO usa las referencias → referencesApplied:0 (no mentir).
      const msg = e instanceof Error ? e.message : String(e)
      console.warn(`[imageGen] Gemini falló (${msg}), fallback a Pollinations`)
      const urls = await pollinationsGenerate(prompt, aspectRatio, styleHint)
      return { provider: `pollinations (fallback: ${msg.slice(0, 80)})`, urls, referencesApplied: 0 }
    }
  }

  if (provider === 'higgsfield') {
    try {
      const urls = await higgsfieldGenerateImage(prompt, aspectRatio, styleHint)
      return { provider: 'higgsfield', urls, referencesApplied: 0 }
    } catch (e) {
      // Cualquier fallo de Higgsfield (créditos, auth, timeout, NSFW del
      // moderador, endpoint cambiado, etc.) cae a Pollinations para que
      // la tarea no se bloquee. Sólo NSFW se propaga porque indica que
      // el prompt es problemático y Pollinations también lo va a rechazar.
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('NSFW')) throw e
      console.warn(`[imageGen] Higgsfield falló (${msg}), fallback a Pollinations`)
      const urls = await pollinationsGenerate(prompt, aspectRatio, styleHint)
      return { provider: `pollinations (fallback: ${msg.slice(0, 80)})`, urls, referencesApplied: 0 }
    }
  }

  const urls = await pollinationsGenerate(prompt, aspectRatio, styleHint)
  return { provider: 'pollinations', urls, referencesApplied: 0 }
}
