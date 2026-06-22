// Visor de PDF (estilo NeuralOS) — se monta como pestaña type:'pdf' del canvas (split view).
// Renderiza las páginas con pdfjs (carga diferida, igual que readFile.js), con zoom, conteo de
// páginas y descarga. Recibe `src` = object URL (blob:) del PDF y `title`. La pestaña es de SESIÓN
// (no se persiste: loadLocalTabs solo conserva 'document'), así que el object URL vive en memoria.
import { useEffect, useRef, useState } from 'react'
import { Download, Loader2, Minus, Plus } from 'lucide-react'

// Carga diferida de pdfjs (no infla el bundle principal) + worker vía URL (patrón Vite, = readFile.js).
let _pdfjs = null
async function loadPdfjs() {
  if (_pdfjs) return _pdfjs
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  _pdfjs = pdfjs
  return pdfjs
}

// Una página → un <canvas>. Ajusta al ancho disponible × zoom y nitidez por devicePixelRatio.
function PdfPage({ doc, pageNumber, width, zoom }) {
  const ref = useRef(null)
  useEffect(() => {
    let cancelled = false
    let task = null
    ;(async () => {
      try {
        const page = await doc.getPage(pageNumber)
        if (cancelled || !ref.current) return
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        const base = page.getViewport({ scale: 1 })
        const fit = Math.max(0.1, width / base.width)
        const vp = page.getViewport({ scale: fit * zoom * dpr })
        const canvas = ref.current
        canvas.width = vp.width
        canvas.height = vp.height
        canvas.style.width = `${vp.width / dpr}px`
        canvas.style.height = `${vp.height / dpr}px`
        task = page.render({ canvasContext: canvas.getContext('2d'), viewport: vp })
        await task.promise
      } catch { /* render cancelado o página inválida */ }
    })()
    return () => { cancelled = true; try { task?.cancel?.() } catch { /* noop */ } }
  }, [doc, pageNumber, width, zoom])
  return <canvas ref={ref} className="mx-auto mb-3 rounded-md shadow-lg bg-white max-w-full" />
}

export default function PdfView({ src, title }) {
  const [doc, setDoc] = useState(null)
  const [status, setStatus] = useState('loading') // loading | ready | error
  const [error, setError] = useState('')
  const [zoom, setZoom] = useState(1)
  const [width, setWidth] = useState(640)
  const scrollRef = useRef(null)

  // Cargar el documento (una vez por src).
  useEffect(() => {
    let cancelled = false
    let d = null
    setStatus('loading'); setError(''); setDoc(null)
    ;(async () => {
      try {
        const pdfjs = await loadPdfjs()
        d = await pdfjs.getDocument(src).promise
        if (cancelled) { try { d.destroy?.() } catch { /* noop */ } return }
        setDoc(d); setStatus('ready')
      } catch (e) {
        if (!cancelled) { setError(e?.message || 'No pude abrir el PDF'); setStatus('error') }
      }
    })()
    return () => { cancelled = true; try { d?.destroy?.() } catch { /* noop */ } }
  }, [src])

  // Ancho disponible para ajustar la página — al montar/cargar y al redimensionar el panel.
  useEffect(() => {
    const measure = () => { const el = scrollRef.current; if (el) setWidth(Math.max(240, el.clientWidth - 32)) }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [status])

  const btn = 'w-7 h-7 grid place-items-center rounded-md text-nina-mute hover:text-nina-chrome hover:bg-nina-line/40 transition disabled:opacity-30'
  return (
    <div className="h-full flex flex-col bg-nina-ink">
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-nina-line/50 shrink-0">
        <div className="min-w-0 flex items-center gap-2 text-[13px] text-nina-chrome">
          <span className="truncate font-medium">{title || 'PDF'}</span>
          {status === 'ready' && doc && <span className="text-[11.5px] text-nina-mute shrink-0">{doc.numPages} pág.</span>}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.15).toFixed(2)))} className={btn} title="Reducir" disabled={status !== 'ready'}><Minus className="w-4 h-4" /></button>
          <span className="text-[11.5px] text-nina-mute w-10 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom((z) => Math.min(3, +(z + 0.15).toFixed(2)))} className={btn} title="Ampliar" disabled={status !== 'ready'}><Plus className="w-4 h-4" /></button>
          <a href={src} download={(title || 'documento').replace(/\.pdf$/i, '') + '.pdf'} className={btn} title="Descargar PDF"><Download className="w-4 h-4" /></a>
        </div>
      </div>
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto p-4">
        {status === 'loading' && (
          <div className="h-full flex items-center justify-center gap-2 text-nina-mute text-[13px]"><Loader2 className="w-5 h-5 animate-spin" /> Abriendo PDF…</div>
        )}
        {status === 'error' && (
          <div className="h-full flex items-center justify-center text-center text-nina-mute text-[13px] px-6">No pude abrir el PDF.<br />{error}</div>
        )}
        {status === 'ready' && doc && Array.from({ length: doc.numPages }, (_, i) => (
          <PdfPage key={i + 1} doc={doc} pageNumber={i + 1} width={width} zoom={zoom} />
        ))}
      </div>
    </div>
  )
}
