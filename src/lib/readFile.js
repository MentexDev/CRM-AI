// Lee un archivo adjunto del chat a TEXTO. Soporta texto plano (cualquier text/*, código, csv,
// json, md, yaml, etc.) y PDF (extracción de texto con pdfjs, cargado de forma diferida). Imágenes
// y binarios de Office aún no se soportan (lanza un error con mensaje claro para el toast).
const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|jsonl|ya?ml|xml|html?|css|js|jsx|ts|tsx|py|rb|go|rs|java|kt|c|cpp|h|hpp|cs|php|swift|sh|bash|zsh|sql|env|ini|toml|conf|log|srt|vtt|tex)$/i
const MAX_CHARS = 100_000 // tope de texto por archivo (coincide con el tope del backend)
const MAX_BYTES = 12 * 1024 * 1024 // 12 MB por archivo

export function fileKind(file) {
  const name = file.name || ''
  const type = file.type || ''
  if (type === 'application/pdf' || /\.pdf$/i.test(name)) return 'pdf'
  if (type.startsWith('text/') || type === 'application/json' || type === 'application/xml' || TEXT_EXT.test(name)) return 'text'
  if (type.startsWith('image/')) return 'image'
  return 'other'
}

async function readText(file) {
  const t = await file.text()
  return t.length > MAX_CHARS ? t.slice(0, MAX_CHARS) : t
}

async function readPdf(file) {
  // Carga diferida de pdfjs (no infla el bundle principal) + worker vía URL (patrón Vite).
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  const data = await file.arrayBuffer()
  const pdf = await pdfjs.getDocument({ data }).promise
  let out = ''
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const tc = await page.getTextContent()
    out += tc.items.map((it) => it.str).join(' ') + '\n\n'
    if (out.length > MAX_CHARS) break
  }
  out = out.trim()
  if (!out) throw new Error('El PDF no tiene texto extraíble (¿es escaneado/imagen?).')
  return out.slice(0, MAX_CHARS)
}

// Devuelve { name, text } o lanza un Error con mensaje legible.
export async function readAttachmentFile(file) {
  if (file.size > MAX_BYTES) throw new Error(`"${file.name}" es muy grande (máx 12 MB).`)
  const kind = fileKind(file)
  if (kind === 'text') return { name: file.name, text: await readText(file) }
  if (kind === 'pdf') return { name: file.name, text: await readPdf(file) }
  if (kind === 'image') throw new Error(`Las imágenes aún no se leen aquí ("${file.name}"). Por ahora: texto y PDF.`)
  throw new Error(`Tipo no soportado todavía: "${file.name}". Por ahora: texto y PDF.`)
}
