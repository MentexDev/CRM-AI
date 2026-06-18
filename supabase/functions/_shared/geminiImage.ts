// Generación de imágenes con Gemini 2.5 Flash Image ("Nano Banana").
// Devuelve la imagen en base64 (inlineData) → la subimos a Supabase Storage (bucket
// público `agent-images`) y entregamos una URL pública, para que el canvas/biblioteca
// y los demás providers compartan el mismo contrato (urls[]).
//
// Secret requerido: GEMINI_API_KEY (de Google AI Studio: https://aistudio.google.com/apikey).

// Modelo de imagen. Default: gemini-3-pro-image (Nano Banana Pro, alta calidad/realismo).
// Configurable por env GEMINI_IMAGE_MODEL (p.ej. 'gemini-3.1-flash-image' para más rápido/barato).
import { adminDb } from './db.ts'

const GEMINI_MODEL = Deno.env.get('GEMINI_IMAGE_MODEL') || 'gemini-3-pro-image'
const BUCKET = 'agent-images'

export async function geminiGenerateImage(
  prompt: string,
  aspectRatio: string,
  styleHint?: string,
): Promise<string[]> {
  const key = Deno.env.get('GEMINI_API_KEY')
  if (!key) throw new Error('GEMINI_API_KEY no está configurado')

  // Nano Banana respeta la relación de aspecto y el realismo mejor si va en el prompt.
  const fullPrompt = [
    styleHint ? `${prompt}. Estilo: ${styleHint}.` : `${prompt}.`,
    `Fotografía hiperrealista, calidad profesional, iluminación natural, alto detalle.`,
    `Composición en relación de aspecto ${aspectRatio}.`,
  ].join(' ')

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
        generationConfig: { responseModalities: ['IMAGE'] },
      }),
    },
  )
  const data = await resp.json().catch(() => ({} as Record<string, unknown>))
  if (!resp.ok) throw new Error(`Gemini ${resp.status}: ${JSON.stringify(data).slice(0, 220)}`)

  const parts = (data as any)?.candidates?.[0]?.content?.parts ?? []
  const img = parts.find((p: any) => p?.inlineData?.data)
  if (!img) throw new Error('Gemini no devolvió imagen (revisa el modelo / responseModalities)')

  const url = await uploadToStorage(img.inlineData.data, img.inlineData.mimeType || 'image/png')
  return [url]
}

// Sube el base64 al bucket público y devuelve la URL pública. Usa el cliente supabase-js
// (service role, bypassa RLS) que maneja los headers correctos — el fetch crudo con
// Authorization: Bearer fallaba con 403 (el SERVICE_ROLE_KEY inyectado no se acepta como
// JWT crudo en el endpoint de Storage).
async function uploadToStorage(b64: string, mime: string): Promise<string> {
  const ext = mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : 'png'
  const path = `gemini/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  const db = adminDb()
  const { error } = await db.storage.from(BUCKET).upload(path, bytes, { contentType: mime, upsert: true })
  if (error) throw new Error(`Storage upload: ${error.message}`)
  return db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
}
