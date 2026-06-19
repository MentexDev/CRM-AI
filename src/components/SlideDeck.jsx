// Visor / editor de PRESENTACIONES (estilo NeuralOS) — se monta como artefacto kind:'slides'
// en el canvas (ArtifactCanvas). Núcleo: escenario 16:9 con la diapositiva activa, navegación
// (flechas + teclado + miniaturas), edición en línea de cada diapositiva, agregar/eliminar
// diapositivas y viñetas, y export a PDF (ventana de impresión, apaisado). Tema oscuro NINA.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronLeft, ChevronRight, Copy, LayoutTemplate, List as ListIcon, Plus, Printer,
  Quote as QuoteIcon, Trash2, Type,
} from 'lucide-react'
import toast from 'react-hot-toast'

const LAYOUTS = [
  { id: 'cover', label: 'Portada', icon: LayoutTemplate },
  { id: 'bullets', label: 'Viñetas', icon: ListIcon },
  { id: 'statement', label: 'Frase', icon: Type },
  { id: 'section', label: 'Sección', icon: LayoutTemplate },
  { id: 'quote', label: 'Cita', icon: QuoteIcon },
]
const LAYOUT_SET = new Set(LAYOUTS.map((l) => l.id))

// Diapositiva en blanco según layout.
const blankSlide = (layout = 'bullets') => ({ layout, heading: '', bullets: layout === 'bullets' ? [''] : [], body: '', note: '' })

// Normaliza una diapositiva entrante: en layout 'bullets' garantiza al menos una viñeta editable.
// Si llegara con bullets:[] (el modelo dio solo heading), escribir en la viñeta fantasma se perdería
// porque [].map() devuelve []. Forzar [''] aquí lo evita en origen.
const normalizeSlide = (x) => {
  const layout = x?.layout || 'bullets'
  const bullets = Array.isArray(x?.bullets) ? x.bullets : []
  return { ...blankSlide(layout), ...x, layout, bullets: layout === 'bullets' && !bullets.length ? [''] : bullets }
}

const SLIDE_CSS = `
.nina-slide-edit:focus { outline: none; }
.nina-slide-edit[data-empty="true"]::before { content: attr(data-placeholder); color: rgba(255,255,255,0.28); pointer-events: none; }
`

// contentEditable robusto: sincroniza el texto desde props SOLO cuando el elemento NO tiene el
// foco (así una edición externa / cambio de diapositiva aplica, pero escribir no salta el cursor).
function Editable({ value, onChange, onKeyDown, className, placeholder, tagName = 'div', dataKey }) {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    if (el && document.activeElement !== el && el.textContent !== (value || '')) {
      el.textContent = value || ''
    }
  }, [value])
  const Tag = tagName
  return (
    <Tag
      ref={ref}
      data-bk={dataKey}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      data-placeholder={placeholder}
      data-empty={!value}
      onInput={(e) => onChange(e.currentTarget.textContent)}
      onKeyDown={onKeyDown}
      className={`nina-slide-edit ${className || ''}`}
    />
  )
}

export default function SlideDeck({ title: initialTitle, subtitle: initialSubtitle, slides: initialSlides, getContentRef, onChange }) {
  const [title, setTitle] = useState(initialTitle || 'Presentación')
  const [subtitle, setSubtitle] = useState(initialSubtitle || '')
  const [slides, setSlides] = useState(() => {
    const s = Array.isArray(initialSlides) ? initialSlides : []
    return s.length ? s.map(normalizeSlide) : [blankSlide('cover')]
  })
  const [idx, setIdx] = useState(0)
  const safeIdx = Math.min(idx, slides.length - 1)
  const cur = slides[safeIdx]

  // Reporte de cambios (debounced) → el padre limpia el "guardado" y persiste si es pestaña local.
  const stateRef = useRef({ title, subtitle, slides })
  stateRef.current = { title, subtitle, slides }
  const fireTimer = useRef(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const scheduleFire = useCallback(() => {
    clearTimeout(fireTimer.current)
    fireTimer.current = setTimeout(() => onChangeRef.current?.(stateRef.current), 400)
  }, [])
  // Vuelca cambios al desmontar (cambio de pestaña / cierre del canvas) para no perder lo último.
  useEffect(() => () => { clearTimeout(fireTimer.current); onChangeRef.current?.(stateRef.current) }, [])

  // El canvas lee esto on-demand al "Guardar" → toma lo EDITADO, no el artefacto original.
  if (getContentRef) getContentRef.current = () => ({ title, subtitle, slides })

  // Mutadores — todos derivan desde `prev` dentro del updater funcional (no del closure del render)
  // para no pisar ediciones concurrentes (escritura rápida + Enter, etc.).
  const patchSlide = (i, patch) => { setSlides((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s))); scheduleFire() }
  // Parte de la lista EFECTIVA (['' ] si está vacía) para que escribir en la viñeta fantasma sí persista.
  const updateBullets = (i, fn) => {
    setSlides((prev) => prev.map((s, j) => (j === i ? { ...s, bullets: fn(s.bullets.length ? s.bullets : ['']) } : s)))
    scheduleFire()
  }
  const patchBullet = (i, bi, text) => updateBullets(i, (bs) => bs.map((b, k) => (k === bi ? text : b)))
  const addBullet = (i, at) => {
    updateBullets(i, (bs) => { const next = [...bs]; next.splice(at + 1, 0, ''); return next })
    requestAnimationFrame(() => focusBullet(at + 1))
  }
  const removeBullet = (i, bi) => {
    updateBullets(i, (bs) => (bs.length <= 1 ? [''] : bs.filter((_, k) => k !== bi)))
    requestAnimationFrame(() => focusBullet(Math.max(0, bi - 1)))
  }
  const focusBullet = (bi) => {
    const el = document.querySelector(`[data-bk="b-${bi}"]`)
    if (el) {
      el.focus()
      const r = document.createRange(); r.selectNodeContents(el); r.collapse(false)
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r)
    }
  }
  const addSlide = () => {
    const at = safeIdx + 1
    setSlides((prev) => { const n = [...prev]; n.splice(at, 0, blankSlide('bullets')); return n })
    setIdx(at)
    scheduleFire()
  }
  const duplicateSlide = () => {
    const at = safeIdx + 1
    setSlides((prev) => { const n = [...prev]; n.splice(at, 0, JSON.parse(JSON.stringify(prev[safeIdx]))); return n })
    setIdx(at)
    scheduleFire()
  }
  const removeSlide = () => {
    if (slides.length <= 1) return
    setSlides((prev) => prev.filter((_, j) => j !== safeIdx))
    setIdx((v) => Math.max(0, v - 1))
    scheduleFire()
  }
  const setLayout = (layout) => {
    // Al pasar a 'bullets' garantizamos al menos una viñeta para que se pueda escribir.
    setSlides((prev) =>
      prev.map((s, j) => {
        if (j !== safeIdx) return s
        const bullets = layout === 'bullets' && (!s.bullets || !s.bullets.length) ? [''] : s.bullets
        return { ...s, layout, bullets }
      }),
    )
    scheduleFire()
  }

  // Navegación con teclado — solo cuando el deck está "activo" (cursor encima o foco dentro de él),
  // para NO secuestrar las flechas del resto del workspace (el canvas es split-view con el chat).
  // Y nunca mientras se edita una celda/viñeta/título (que las flechas muevan el cursor).
  const rootRef = useRef(null)
  const hoverRef = useRef(false)
  useEffect(() => {
    const onKey = (e) => {
      const ae = document.activeElement
      if (ae?.isContentEditable || ['INPUT', 'TEXTAREA'].includes(ae?.tagName)) return
      if (!hoverRef.current && !rootRef.current?.contains(ae)) return
      if (e.key === 'ArrowRight' || e.key === 'PageDown') { setIdx((v) => Math.min(v + 1, slides.length - 1)); }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { setIdx((v) => Math.max(v - 1, 0)); }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [slides.length])

  const exportPDF = () => {
    const w = window.open('', '_blank')
    if (!w) { toast.error('Permite las ventanas emergentes para exportar a PDF'); return }
    const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
    const slideHTML = (s) => {
      if (s.layout === 'cover') {
        return `<div class="c center"><div class="kicker">NINA</div><h1>${esc(s.heading || title)}</h1>${s.body ? `<p class="sub">${esc(s.body)}</p>` : ''}</div>`
      }
      if (s.layout === 'statement') return `<div class="c center"><h2 class="stmt">${esc(s.heading)}</h2>${s.body ? `<p class="sub">${esc(s.body)}</p>` : ''}</div>`
      if (s.layout === 'section') return `<div class="c center"><div class="kicker">Sección</div><h1>${esc(s.heading)}</h1></div>`
      if (s.layout === 'quote') return `<div class="c center"><blockquote>“${esc(s.heading)}”</blockquote>${s.body ? `<p class="attr">— ${esc(s.body)}</p>` : ''}</div>`
      const items = (s.bullets || []).filter(Boolean).map((b) => `<li>${esc(b)}</li>`).join('')
      return `<div class="c"><h2>${esc(s.heading)}</h2><ul>${items}</ul>${s.body ? `<p class="sub">${esc(s.body)}</p>` : ''}</div>`
    }
    // Saltamos diapositivas sin contenido renderizable para no generar páginas mudas en el PDF
    // (mismo criterio que el filtro del motor; 'cover' siempre cae al título del mazo).
    const renderable = (s) => s.layout === 'cover' || s.heading || s.body || (s.bullets || []).some(Boolean)
    const pages = slides.filter(renderable).map((s) => `<section class="slide">${slideHTML(s)}</section>`).join('')
    w.document.write(
      `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>` +
        `@page{size:A4 landscape;margin:0}*{box-sizing:border-box}` +
        `body{margin:0;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:#16181d}` +
        `.slide{width:297mm;height:209mm;page-break-after:always;padding:18mm 22mm;display:flex;background:#fff;border-bottom:1px solid #eee}` +
        `.c{width:100%;align-self:center}.center{text-align:center;display:flex;flex-direction:column;justify-content:center;align-items:center;height:100%}` +
        `.kicker{letter-spacing:.32em;text-transform:uppercase;font-size:13px;color:#9aa0aa;margin-bottom:14px}` +
        `h1{font-size:46px;line-height:1.1;margin:0;font-weight:800}h2{font-size:34px;margin:0 0 22px;font-weight:700}` +
        `.stmt{font-size:42px;font-weight:800;line-height:1.15;max-width:80%}` +
        `.sub{font-size:20px;color:#5a5f6a;margin-top:16px}ul{font-size:23px;line-height:1.6;padding-left:1.1em}li{margin:.35em 0}` +
        `blockquote{font-size:34px;font-style:italic;max-width:80%;margin:0;line-height:1.3}.attr{font-size:20px;color:#5a5f6a;margin-top:18px}` +
        `</style></head><body>${pages}</body></html>`,
    )
    w.document.close()
    w.focus()
    setTimeout(() => w.print(), 350)
  }

  // ── Render de la diapositiva activa (editable) ──────────────────────────────
  const headingClass = 'font-bold text-nina-chrome leading-tight'
  const renderStage = () => {
    if (cur.layout === 'cover') {
      return (
        <div className="h-full flex flex-col items-center justify-center text-center px-[8%]">
          <div className="text-[11px] tracking-[0.34em] uppercase text-nina-silver mb-4">NINA</div>
          <Editable value={cur.heading} onChange={(t) => patchSlide(safeIdx, { heading: t })} placeholder="Título de la portada"
            className={`${headingClass} text-[clamp(28px,5vw,52px)]`} />
          <Editable value={cur.body} onChange={(t) => patchSlide(safeIdx, { body: t })} placeholder="Subtítulo (opcional)"
            className="text-nina-mute text-[clamp(15px,2vw,22px)] mt-4 max-w-[80%]" />
        </div>
      )
    }
    if (cur.layout === 'statement') {
      return (
        <div className="h-full flex flex-col items-center justify-center text-center px-[8%]">
          <Editable value={cur.heading} onChange={(t) => patchSlide(safeIdx, { heading: t })} placeholder="Frase de impacto"
            className={`${headingClass} text-[clamp(26px,4.4vw,44px)] max-w-[85%]`} />
          <Editable value={cur.body} onChange={(t) => patchSlide(safeIdx, { body: t })} placeholder="Apoyo (opcional)"
            className="text-nina-mute text-[clamp(14px,1.8vw,20px)] mt-4 max-w-[75%]" />
        </div>
      )
    }
    if (cur.layout === 'section') {
      return (
        <div className="h-full flex flex-col items-center justify-center text-center px-[8%]">
          <div className="text-[11px] tracking-[0.3em] uppercase text-nina-silver mb-3">Sección {safeIdx + 1}</div>
          <Editable value={cur.heading} onChange={(t) => patchSlide(safeIdx, { heading: t })} placeholder="Nombre de la sección"
            className={`${headingClass} text-[clamp(26px,4.6vw,46px)]`} />
        </div>
      )
    }
    if (cur.layout === 'quote') {
      return (
        <div className="h-full flex flex-col items-center justify-center text-center px-[8%]">
          <div className="text-nina-silver/40 text-6xl leading-none mb-1">“</div>
          <Editable value={cur.heading} onChange={(t) => patchSlide(safeIdx, { heading: t })} placeholder="La cita"
            className="text-nina-chrome italic text-[clamp(20px,3.2vw,34px)] leading-snug max-w-[82%]" />
          <Editable value={cur.body} onChange={(t) => patchSlide(safeIdx, { body: t })} placeholder="Autor (opcional)"
            className="text-nina-mute text-[clamp(13px,1.6vw,18px)] mt-4" />
        </div>
      )
    }
    // bullets (default)
    return (
      <div className="h-full flex flex-col justify-center px-[8%] py-[7%]">
        <Editable value={cur.heading} onChange={(t) => patchSlide(safeIdx, { heading: t })} placeholder="Título de la diapositiva"
          className={`${headingClass} text-[clamp(22px,3.4vw,36px)] mb-5`} />
        <ul className="space-y-2.5">
          {(cur.bullets.length ? cur.bullets : ['']).map((b, bi) => (
            <li key={bi} className="flex items-start gap-3 group">
              <span className="mt-[0.7em] w-1.5 h-1.5 rounded-full bg-nina-silver shrink-0" />
              <Editable
                value={b}
                dataKey={`b-${bi}`}
                onChange={(t) => patchBullet(safeIdx, bi, t)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); addBullet(safeIdx, bi) }
                  else if (e.key === 'Backspace' && !e.currentTarget.textContent) { e.preventDefault(); removeBullet(safeIdx, bi) }
                }}
                placeholder="Punto clave"
                className="flex-1 text-nina-chrome/90 text-[clamp(14px,1.9vw,21px)] leading-relaxed"
              />
              <button
                onClick={() => removeBullet(safeIdx, bi)}
                className="mt-[0.4em] opacity-0 group-hover:opacity-100 text-nina-mute hover:text-red-300 transition shrink-0"
                title="Quitar viñeta"
              >
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
        <button onClick={() => addBullet(safeIdx, cur.bullets.length - 1)} className="mt-3 self-start flex items-center gap-1.5 text-[12px] text-nina-mute hover:text-nina-chrome transition">
          <Plus size={13} /> viñeta
        </button>
      </div>
    )
  }

  const tbBtn = 'flex items-center gap-1 px-2 py-1 rounded-md text-[11.5px] text-nina-mute hover:text-nina-chrome hover:bg-nina-line/40 transition-colors'

  return (
    <div
      ref={rootRef}
      onMouseEnter={() => { hoverRef.current = true }}
      onMouseLeave={() => { hoverRef.current = false }}
      className="h-full flex flex-col bg-nina-ink"
    >
      <style>{SLIDE_CSS}</style>
      {/* Barra superior: título del mazo + acciones */}
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-nina-line/50 shrink-0">
        <input
          value={title}
          onChange={(e) => { setTitle(e.target.value); scheduleFire() }}
          placeholder="Título de la presentación"
          className="min-w-0 flex-1 bg-transparent text-nina-chrome text-[13px] font-medium outline-none placeholder:text-nina-mute/40"
        />
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-[11.5px] text-nina-mute px-1">{safeIdx + 1} / {slides.length}</span>
          <button onClick={exportPDF} className={tbBtn} title="Imprimir / PDF"><Printer size={13} /> PDF</button>
        </div>
      </div>

      {/* Selector de layout de la diapositiva activa */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-nina-line/40 shrink-0 overflow-x-auto">
        {LAYOUTS.map((l) => {
          const I = l.icon
          const on = (cur.layout || 'bullets') === l.id
          return (
            <button
              key={l.id}
              onClick={() => setLayout(l.id)}
              className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] transition shrink-0 ${
                on ? 'bg-silver-gradient text-nina-black' : 'text-nina-mute hover:text-nina-chrome hover:bg-nina-line/40'
              }`}
              title={l.label}
            >
              <I size={12} /> {l.label}
            </button>
          )
        })}
        <div className="flex-1" />
        <button onClick={duplicateSlide} className={tbBtn} title="Duplicar diapositiva"><Copy size={13} /></button>
        <button onClick={removeSlide} disabled={slides.length <= 1} className={`${tbBtn} disabled:opacity-30`} title="Eliminar diapositiva"><Trash2 size={13} /></button>
      </div>

      {/* Escenario 16:9 con la diapositiva activa */}
      <div className="flex-1 min-h-0 flex items-center justify-center p-4 overflow-hidden">
        <div className="relative w-full max-w-[920px]" style={{ aspectRatio: '16 / 9', maxHeight: '100%' }}>
          <button
            onClick={() => setIdx((v) => Math.max(0, v - 1))}
            disabled={safeIdx === 0}
            className="absolute left-[-14px] top-1/2 -translate-y-1/2 z-10 w-8 h-8 grid place-items-center rounded-full bg-nina-panel/90 border border-nina-line text-nina-mute hover:text-nina-chrome disabled:opacity-30 disabled:cursor-default shadow-lg"
            aria-label="Anterior"
          >
            <ChevronLeft size={18} />
          </button>
          <div
            className="w-full h-full rounded-xl border border-nina-line overflow-hidden shadow-2xl"
            style={{ background: 'radial-gradient(120% 120% at 0% 0%, #1b1e26 0%, #121319 60%, #0d0e12 100%)' }}
          >
            {renderStage()}
          </div>
          <button
            onClick={() => setIdx((v) => Math.min(slides.length - 1, v + 1))}
            disabled={safeIdx >= slides.length - 1}
            className="absolute right-[-14px] top-1/2 -translate-y-1/2 z-10 w-8 h-8 grid place-items-center rounded-full bg-nina-panel/90 border border-nina-line text-nina-mute hover:text-nina-chrome disabled:opacity-30 disabled:cursor-default shadow-lg"
            aria-label="Siguiente"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      {/* Notas del presentador (privadas): NO se muestran en la diapositiva ni en el PDF, pero se
          editan aquí y se conservan al guardar en la biblioteca. */}
      <div className="px-4 pb-2 shrink-0">
        <textarea
          value={cur.note || ''}
          onChange={(e) => patchSlide(safeIdx, { note: e.target.value })}
          placeholder="Notas del presentador (privadas)…"
          rows={1}
          className="w-full resize-none bg-nina-panel/40 border border-nina-line/50 rounded-lg px-2.5 py-1.5 text-[11.5px] text-nina-mute outline-none focus:text-nina-chrome focus:border-nina-silver/40 placeholder:text-nina-mute/40"
        />
      </div>

      {/* Tira de miniaturas */}
      <div className="flex items-center gap-2 px-3 py-2 border-t border-nina-line/50 shrink-0 overflow-x-auto">
        {slides.map((s, i) => (
          <button
            key={i}
            onClick={() => setIdx(i)}
            title={s.heading || `Diapositiva ${i + 1}`}
            className={`relative shrink-0 w-[68px] rounded-md border overflow-hidden text-left transition ${
              i === safeIdx ? 'border-nina-silver' : 'border-nina-line/70 hover:border-nina-silver/50'
            }`}
            style={{ aspectRatio: '16 / 9' }}
          >
            <div className="w-full h-full p-1.5 flex flex-col justify-center" style={{ background: 'linear-gradient(135deg, #1b1e26, #0d0e12)' }}>
              <div className="text-[6.5px] leading-tight text-nina-chrome/90 line-clamp-3 font-medium">
                {s.heading || (s.bullets || []).filter(Boolean)[0] || '—'}
              </div>
            </div>
            <span className="absolute bottom-0.5 right-1 text-[7px] text-nina-mute">{i + 1}</span>
          </button>
        ))}
        <button
          onClick={addSlide}
          className="shrink-0 w-[68px] grid place-items-center rounded-md border border-dashed border-nina-line/70 text-nina-mute hover:text-nina-chrome hover:border-nina-silver/50 transition"
          style={{ aspectRatio: '16 / 9' }}
          title="Agregar diapositiva"
        >
          <Plus size={16} />
        </button>
      </div>
    </div>
  )
}
