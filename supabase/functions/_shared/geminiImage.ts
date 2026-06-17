// Generación de imágenes con Gemini 2.5 Flash Image ("Nano Banana").
// Devuelve la imagen en base64 (inlineData) → la subimos a Supabase Storage (bucket
// público `agent-images`) y entregamos una URL pública, para que el canvas/biblioteca
// y los demás providers compartan el mismo contrato (urls[]).
//
// Secret requerido: GEMINI_API_KEY (de Google AI Studio: https://aistudio.google.com/apikey).

const GEMINI_MODEL = 'gemini-2.5-flash-image' // Nano Banana
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
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

// Sube el base64 al bucket público y devuelve la URL pública. Service role (bypassa RLS).
async function uploadToStorage(b64: string, mime: string): Promise<string> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const ext = mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : 'png'
  const path = `gemini/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  const up = await fetch(`${supabaseUrl}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${serviceKey}`, 'Content-Type': mime, 'x-upsert': 'true' },
    body: bytes,
  })
  if (!up.ok) throw new Error(`Storage upload ${up.status}: ${(await up.text()).slice(0, 150)}`)
  return `${supabaseUrl}/storage/v1/object/public/${BUCKET}/${path}`
}
