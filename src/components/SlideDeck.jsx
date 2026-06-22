// Visor / editor de PRESENTACIONES (estilo NeuralOS) — se monta como artefacto kind:'slides'
// en el canvas (ArtifactCanvas). Núcleo: escenario 16:9 con la diapositiva activa, navegación
// (flechas + teclado + miniaturas), edición en línea de cada diapositiva, agregar/eliminar
// diapositivas y viñetas, export a PDF (apaisado) y — con el lápiz ✏️ — una barra de FORMATO:
// tema/fondo de color, color de texto, alineación y tamaño (por diapositiva). Tema oscuro NINA.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlignCenter, AlignLeft, AlignRight, ChevronLeft, ChevronRight, Copy, LayoutTemplate,
  List as ListIcon, Minus, Palette, Pencil, Plus, Printer, Quote as QuoteIcon, Trash2, Type,
} from 'lucide-react'
import toast from 'react-hot-toast'

const LAYOUTS = [
  { id: 'cover', label: 'Portada', icon: LayoutTemplate },
  { id: 'bullets', label: 'Viñetas', icon: ListIcon },
  { id: 'statement', label: 'Frase', icon: Type },
  { id: 'section', label: 'Sección', icon: LayoutTemplate },
  { id: 'quote', label: 'Cita', icon: QuoteIcon },
]

// ── Tema (deck) y estilo (por diapositiva) ──────────────────────────────────
// El tema controla el LOOK del mazo (fondo + color de texto + acento). El estilo por
// diapositiva permite alinear y escalar el texto de esa lámina.
const DEFAULT_THEME = {
  background: 'radial-gradient(120% 120% at 0% 0%, #1b1e26 0%, #121319 60%, #0d0e12 100%)',
  text: '#e9ebee',
  accent: '#aab0bb',
}
const THEME_PRESETS = [
  { id: 'nina', label: 'NINA', swatch: '#15171d', ...DEFAULT_THEME },
  { id: 'claro', label: 'Claro', swatch: '#f7f7f5', background: '#f7f7f5', text: '#1a1c22', accent: '#8a8f9a' },
  { id: 'rojo-amarillo', label: 'Rojo-Amarillo', swatch: 'linear-gradient(135deg,#e11d48,#f59e0b)', background: 'linear-gradient(135deg, #e11d48 0%, #f59e0b 100%)', text: '#ffffff', accent: 'rgba(255,255,255,0.88)' },
  { id: 'noche', label: 'Noche', swatch: 'linear-gradient(160deg,#0b1220,#1e293b)', background: 'linear-gradient(160deg, #0b1220 0%, #1e293b 100%)', text: '#e6edf6', accent: '#8aa0bd' },
]
const ALIGN_ITEMS = { left: 'flex-start', center: 'center', right: 'flex-end' }
const FONT_SCALES = [0.85, 1, 1.15, 1.3]
const defaultAlign = (layout) => (layout === 'bullets' ? 'left' : 'center')
// clamp escalado: con sc=1 da exactamente el tamaño original (cero regresión visual).
const fs = (min, vw, max, sc = 1) => `clamp(${(min * sc).toFixed(1)}px, ${(vw * sc).toFixed(2)}vw, ${(max * sc).toFixed(1)}px)`
// Sanea un valor CSS de color/gradiente: bloquea ; { } < > " ' (inyección en el PDF y defensa
// general). Permite hex, rgb/rgba, gradientes y nombres. Si no pasa, cae al fallback.
const cssColor = (v, fallback) => {
  if (typeof v !== 'string') return fallback
  const s = v.trim().slice(0, 200)
  return /^[#a-zA-Z0-9 ,.%()/-]+$/.test(s) ? s : fallback
}
const sanitizeTheme = (t) => {
  if (!t || typeof t !== 'object') return null
  return {
    background: cssColor(t.background, DEFAULT_THEME.background),
    text: cssColor(t.text, DEFAULT_THEME.text),
    accent: cssColor(t.accent, DEFAULT_THEME.accent),
  }
}

// Diapositiva en blanco según layout.
const blankSlide = (layout = 'bullets') => ({ layout, heading: '', bullets: layout === 'bullets' ? [''] : [], body: '', note: '' })

// Normaliza una diapositiva entrante: en layout 'bullets' garantiza al menos una viñeta editable.
const normalizeSlide = (x) => {
  const layout = x?.layout || 'bullets'
  const bullets = Array.isArray(x?.bullets) ? x.bullets : []
  return { ...blankSlide(layout), ...x, layout, bullets: layout === 'bullets' && !bullets.length ? [''] : bullets }
}

const SLIDE_CSS = `
.nina-slide-edit:focus { outline: none; }
.nina-slide-edit[data-empty="true"]::before { content: attr(data-placeholder); color: rgba(127,127,127,0.45); pointer-events: none; }
`

// contentEditable robusto: sincroniza el texto desde props SOLO cuando el elemento NO tiene el
// foco (así una edición externa / cambio de diapositiva aplica, pero escribir no salta el cursor).
function Editable({ value, onChange, onKeyDown, className, style, placeholder, tagName = 'div', dataKey }) {
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
      style={style}
      onInput={(e) => onChange(e.currentTarget.textContent)}
      onKeyDown={onKeyDown}
      className={`nina-slide-edit ${className || ''}`}
    />
  )
}

export default function SlideDeck({ title: initialTitle, subtitle: initialSubtitle, slides: initialSlides, theme: initialTheme, getContentRef, onChange }) {
  const [title, setTitle] = useState(initialTitle || 'Presentación')
  const [subtitle, setSubtitle] = useState(initialSubtitle || '')
  const [theme, setTheme] = useState(() => sanitizeTheme(initialTheme) || { ...DEFAULT_THEME })
  const [editMode, setEditMode] = useState(false)
  const [slides, setSlides] = useState(() => {
    const s = Array.isArray(initialSlides) ? initialSlides : []
    return s.length ? s.map(normalizeSlide) : [blankSlide('cover')]
  })
  const [idx, setIdx] = useState(0)
  const safeIdx = Math.min(idx, slides.length - 1)
  const cur = slides[safeIdx]

  // Reporte de cambios (debounced) → el padre limpia el "guardado" y persiste si es pestaña local.
  const stateRef = useRef({ title, subtitle, slides, theme })
  stateRef.current = { title, subtitle, slides, theme }
  const fireTimer = useRef(null)
  const dirtyRef = useRef(false) // solo true tras una edición real → abrir+cambiar de pestaña no marca dirty
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const scheduleFire = useCallback(() => {
    dirtyRef.current = true
    clearTimeout(fireTimer.current)
    fireTimer.current = setTimeout(() => onChangeRef.current?.(stateRef.current), 400)
  }, [])
  // Vuelca cambios al desmontar SOLO si hubo edición (no ensucia "guardado" al solo abrir).
  useEffect(() => () => { clearTimeout(fireTimer.current); if (dirtyRef.current) onChangeRef.current?.(stateRef.current) }, [])

  // El canvas lee esto on-demand al "Guardar" → toma lo EDITADO, no el artefacto original.
  if (getContentRef) getContentRef.current = () => ({ title, subtitle, slides, theme })

  // Mutadores — todos derivan desde `prev` dentro del updater funcional (no del closure del render)
  // para no pisar ediciones concurrentes (escritura rápida + Enter, etc.).
  const patchSlide = (i, patch) => { setSlides((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s))); scheduleFire() }
  // Estilo por diapositiva (alineación/escala): merge dentro de slide.style.
  const patchStyle = (i, patch) => { setSlides((prev) => prev.map((s, j) => (j === i ? { ...s, style: { ...s.style, ...patch } } : s))); scheduleFire() }
  const setDeckTheme = (patch) => { setTheme((prev) => ({ ...prev, ...patch })); scheduleFire() }
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
    setSlides((prev) =>
      prev.map((s, j) => {
        if (j !== safeIdx) return s
        const bullets = layout === 'bullets' && (!s.bullets || !s.bullets.length) ? [''] : s.bullets
        return { ...s, layout, bullets }
      }),
    )
    scheduleFire()
  }
  // Tamaño: sube/baja un escalón en FONT_SCALES.
  const bumpScale = (dir) => {
    const curScale = cur.style?.scale || 1
    const i = FONT_SCALES.indexOf(curScale)
    const at = i === -1 ? 1 : i
    const next = FONT_SCALES[Math.min(FONT_SCALES.length - 1, Math.max(0, at + dir))]
    patchStyle(safeIdx, { scale: next })
  }

  // Navegación con teclado — solo cuando el deck está "activo" (cursor encima o foco dentro de él).
  const rootRef = useRef(null)
  const hoverRef = useRef(false)
  useEffect(() => {
    const onKey = (e) => {
      const ae = document.activeElement
      if (ae?.isContentEditable || ['INPUT', 'TEXTAREA'].includes(ae?.tagName)) return
      if (!hoverRef.current && !rootRef.current?.contains(ae)) return
      if (e.key === 'ArrowRight' || e.key === 'PageDown') { setIdx((v) => Math.min(v + 1, slides.length - 1)) }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { setIdx((v) => Math.max(v - 1, 0)) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [slides.length])

  const exportPDF = () => {
    const w = window.open('', '_blank')
    if (!w) { toast.error('Permite las ventanas emergentes para exportar a PDF'); return }
    const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
    // Tema saneado para el PDF (los valores van a un <style>/inline → defensa contra inyección).
    const bg = cssColor(theme.background, DEFAULT_THEME.background)
    const fg = cssColor(theme.text, DEFAULT_THEME.text)
    const ac = cssColor(theme.accent, DEFAULT_THEME.accent)
    const slideHTML = (s) => {
      const al = s.style?.align || defaultAlign(s.layout)
      const ai = al === 'center' ? 'center' : al === 'right' ? 'flex-end' : 'flex-start'
      if (s.layout === 'cover') {
        return `<div class="c center"><div class="kicker">NINA</div><h1>${esc(s.heading || title)}</h1>${s.body ? `<p class="sub">${esc(s.body)}</p>` : ''}</div>`
      }
      if (s.layout === 'statement') return `<div class="c center"><h2 class="stmt">${esc(s.heading)}</h2>${s.body ? `<p class="sub">${esc(s.body)}</p>` : ''}</div>`
      if (s.layout === 'section') return `<div class="c center"><div class="kicker">Sección</div><h1>${esc(s.heading)}</h1></div>`
      if (s.layout === 'quote') return `<div class="c center"><blockquote>“${esc(s.heading)}”</blockquote>${s.body ? `<p class="attr">— ${esc(s.body)}</p>` : ''}</div>`
      const items = (s.bullets || []).filter(Boolean).map((b) => `<li>${esc(b)}</li>`).join('')
      return `<div class="c" style="text-align:${al};align-items:${ai}"><h2>${esc(s.heading)}</h2><ul>${items}</ul>${s.body ? `<p class="sub">${esc(s.body)}</p>` : ''}</div>`
    }
    const renderable = (s) => s.layout === 'cover' || s.heading || s.body || (s.bullets || []).some(Boolean)
    const pages = slides.filter(renderable).map((s) => `<section class="slide">${slideHTML(s)}</section>`).join('')
    w.document.write(
      `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>` +
        `@page{size:A4 landscape;margin:0}*{box-sizing:border-box}` +
        `html{-webkit-print-color-adjust:exact;print-color-adjust:exact}` +
        `body{margin:0;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:${fg}}` +
        `.slide{width:297mm;height:209mm;page-break-after:always;padding:18mm 22mm;display:flex;background:${bg};border-bottom:1px solid rgba(127,127,127,.25)}` +
        `.c{width:100%;align-self:center}.center{text-align:center;display:flex;flex-direction:column;justify-content:center;align-items:center;height:100%}` +
        `.kicker{letter-spacing:.32em;text-transform:uppercase;font-size:13px;color:${ac};margin-bottom:14px}` +
        `h1{font-size:46px;line-height:1.1;margin:0;font-weight:800;color:${fg}}h2{font-size:34px;margin:0 0 22px;font-weight:700;color:${fg}}` +
        `.stmt{font-size:42px;font-weight:800;line-height:1.15;max-width:80%}` +
        `.sub{font-size:20px;color:${ac};margin-top:16px}ul{font-size:23px;line-height:1.6;padding-left:1.1em;color:${fg}}li{margin:.35em 0}` +
        `blockquote{font-size:34px;font-style:italic;max-width:80%;margin:0;line-height:1.3;color:${fg}}.attr{font-size:20px;color:${ac};margin-top:18px}` +
        `</style></head><body>${pages}</body></html>`,
    )
    w.document.close()
    w.focus()
    setTimeout(() => w.print(), 350)
  }

  // ── Render de la diapositiva activa (editable) ──────────────────────────────
  const align = cur.style?.align || defaultAlign(cur.layout)
  const sc = cur.style?.scale || 1
  const ai = ALIGN_ITEMS[align] || 'flex-start'
  const headingClass = 'font-bold leading-tight'
  const renderStage = () => {
    if (cur.layout === 'cover') {
      return (
        <div className="h-full flex flex-col justify-center px-[8%]" style={{ alignItems: ai, textAlign: align }}>
          <div className="text-[11px] tracking-[0.34em] uppercase mb-4" style={{ color: theme.accent }}>NINA</div>
          <Editable value={cur.heading} onChange={(t) => patchSlide(safeIdx, { heading: t })} placeholder="Título de la portada"
            className={headingClass} style={{ color: theme.text, fontSize: fs(28, 5, 52, sc) }} />
          <Editable value={cur.body} onChange={(t) => patchSlide(safeIdx, { body: t })} placeholder="Subtítulo (opcional)"
            className="mt-4 max-w-[80%]" style={{ color: theme.accent, fontSize: fs(15, 2, 22, sc) }} />
        </div>
      )
    }
    if (cur.layout === 'statement') {
      return (
        <div className="h-full flex flex-col justify-center px-[8%]" style={{ alignItems: ai, textAlign: align }}>
          <Editable value={cur.heading} onChange={(t) => patchSlide(safeIdx, { heading: t })} placeholder="Frase de impacto"
            className={`${headingClass} max-w-[85%]`} style={{ color: theme.text, fontSize: fs(26, 4.4, 44, sc) }} />
          <Editable value={cur.body} onChange={(t) => patchSlide(safeIdx, { body: t })} placeholder="Apoyo (opcional)"
            className="mt-4 max-w-[75%]" style={{ color: theme.accent, fontSize: fs(14, 1.8, 20, sc) }} />
        </div>
      )
    }
    if (cur.layout === 'section') {
      return (
        <div className="h-full flex flex-col justify-center px-[8%]" style={{ alignItems: ai, textAlign: align }}>
          <div className="text-[11px] tracking-[0.3em] uppercase mb-3" style={{ color: theme.accent }}>Sección {safeIdx + 1}</div>
          <Editable value={cur.heading} onChange={(t) => patchSlide(safeIdx, { heading: t })} placeholder="Nombre de la sección"
            className={headingClass} style={{ color: theme.text, fontSize: fs(26, 4.6, 46, sc) }} />
        </div>
      )
    }
    if (cur.layout === 'quote') {
      return (
        <div className="h-full flex flex-col justify-center px-[8%]" style={{ alignItems: ai, textAlign: align }}>
          <div className="text-6xl leading-none mb-1" style={{ color: theme.accent, opacity: 0.5 }}>“</div>
          <Editable value={cur.heading} onChange={(t) => patchSlide(safeIdx, { heading: t })} placeholder="La cita"
            className="italic leading-snug max-w-[82%]" style={{ color: theme.text, fontSize: fs(20, 3.2, 34, sc) }} />
          <Editable value={cur.body} onChange={(t) => patchSlide(safeIdx, { body: t })} placeholder="Autor (opcional)"
            className="mt-4" style={{ color: theme.accent, fontSize: fs(13, 1.6, 18, sc) }} />
        </div>
      )
    }
    // bullets (default)
    return (
      <div className="h-full flex flex-col justify-center px-[8%] py-[7%]" style={{ alignItems: ai, textAlign: align }}>
        <Editable value={cur.heading} onChange={(t) => patchSlide(safeIdx, { heading: t })} placeholder="Título de la diapositiva"
          className={`${headingClass} mb-5 w-full`} style={{ color: theme.text, fontSize: fs(22, 3.4, 36, sc) }} />
        <ul className="space-y-2.5 w-full" style={{ maxWidth: align === 'center' ? '80%' : undefined }}>
          {(cur.bullets.length ? cur.bullets : ['']).map((b, bi) => (
            <li key={bi} className="flex items-start gap-3 group" style={{ justifyContent: ai, textAlign: 'left' }}>
              <span className="mt-[0.7em] w-1.5 h-1.5 rounded-full shrink-0" style={{ background: theme.accent }} />
              <Editable
                value={b}
                dataKey={`b-${bi}`}
                onChange={(t) => patchBullet(safeIdx, bi, t)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); addBullet(safeIdx, bi) }
                  else if (e.key === 'Backspace' && !e.currentTarget.textContent) { e.preventDefault(); removeBullet(safeIdx, bi) }
                }}
                placeholder="Punto clave"
                className="leading-relaxed"
                style={{ color: theme.text, fontSize: fs(14, 1.9, 21, sc), flex: align === 'center' ? '0 1 auto' : '1' }}
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
  const fmtBtn = (on) => `flex items-center justify-center w-7 h-7 rounded-md transition shrink-0 ${on ? 'bg-silver-gradient text-nina-black' : 'text-nina-mute hover:text-nina-chrome hover:bg-nina-line/40'}`

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

      {/* Selector de layout + lápiz de formato + duplicar/eliminar */}
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
        <button
          onClick={() => setEditMode((v) => !v)}
          className={`${tbBtn} ${editMode ? 'bg-silver-gradient text-nina-black hover:bg-silver-gradient hover:text-nina-black' : ''}`}
          title="Formato (fondo, color, alineación, tamaño)"
        >
          <Pencil size={13} /> Editar
        </button>
        <button onClick={duplicateSlide} className={tbBtn} title="Duplicar diapositiva"><Copy size={13} /></button>
        <button onClick={removeSlide} disabled={slides.length <= 1} className={`${tbBtn} disabled:opacity-30`} title="Eliminar diapositiva"><Trash2 size={13} /></button>
      </div>

      {/* Barra de FORMATO (lápiz activo): tema/fondo + color de texto + alineación + tamaño */}
      {editMode && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-nina-line/40 shrink-0 overflow-x-auto text-[11px]">
          <span className="text-nina-mute shrink-0">Fondo</span>
          {THEME_PRESETS.map((p) => {
            const on = theme.background === p.background
            return (
              <button
                key={p.id}
                onClick={() => setDeckTheme({ background: p.background, text: p.text, accent: p.accent })}
                className={`flex items-center gap-1.5 pl-1 pr-2 py-0.5 rounded-md border transition shrink-0 ${on ? 'border-nina-silver text-nina-chrome' : 'border-nina-line/70 text-nina-mute hover:text-nina-chrome'}`}
                title={p.label}
              >
                <span className="w-3.5 h-3.5 rounded-full border border-white/20 shrink-0" style={{ background: p.swatch }} />
                {p.label}
              </button>
            )
          })}
          <label className="flex items-center gap-1 shrink-0 cursor-pointer text-nina-mute hover:text-nina-chrome" title="Color de fondo personalizado">
            <Palette size={13} />
            <input
              type="color"
              value={theme.background.startsWith('#') ? theme.background : '#15171d'}
              onChange={(e) => setDeckTheme({ background: e.target.value })}
              className="w-5 h-5 rounded cursor-pointer bg-transparent border border-nina-line/70"
            />
          </label>
          <span className="w-px h-4 bg-nina-line/60 shrink-0" />
          <label className="flex items-center gap-1 shrink-0 cursor-pointer text-nina-mute hover:text-nina-chrome" title="Color del texto">
            <Type size={13} />
            <input
              type="color"
              value={theme.text.startsWith('#') ? theme.text : '#e9ebee'}
              onChange={(e) => setDeckTheme({ text: e.target.value })}
              className="w-5 h-5 rounded cursor-pointer bg-transparent border border-nina-line/70"
            />
          </label>
          <span className="w-px h-4 bg-nina-line/60 shrink-0" />
          <button onClick={() => patchStyle(safeIdx, { align: 'left' })} className={fmtBtn(align === 'left')} title="Alinear a la izquierda"><AlignLeft size={14} /></button>
          <button onClick={() => patchStyle(safeIdx, { align: 'center' })} className={fmtBtn(align === 'center')} title="Centrar"><AlignCenter size={14} /></button>
          <button onClick={() => patchStyle(safeIdx, { align: 'right' })} className={fmtBtn(align === 'right')} title="Alinear a la derecha"><AlignRight size={14} /></button>
          <span className="w-px h-4 bg-nina-line/60 shrink-0" />
          <button onClick={() => bumpScale(-1)} className={fmtBtn(false)} title="Texto más pequeño"><Minus size={14} /></button>
          <span className="text-nina-mute shrink-0 w-9 text-center tabular-nums">{Math.round(sc * 100)}%</span>
          <button onClick={() => bumpScale(1)} className={fmtBtn(false)} title="Texto más grande"><Plus size={14} /></button>
        </div>
      )}

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
            style={{ background: theme.background }}
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

      {/* Notas del presentador (privadas): NO se muestran en la diapositiva ni en el PDF. */}
      <div className="px-4 pb-2 shrink-0">
        <textarea
          value={cur.note || ''}
          onChange={(e) => patchSlide(safeIdx, { note: e.target.value })}
          placeholder="Notas del presentador (privadas)…"
          rows={1}
          className="w-full resize-none bg-nina-panel/40 border border-nina-line/50 rounded-lg px-2.5 py-1.5 text-[11.5px] text-nina-mute outline-none focus:text-nina-chrome focus:border-nina-silver/40 placeholder:text-nina-mute/40"
        />
      </div>

      {/* Tira de miniaturas (con el fondo del tema) */}
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
            <div className="w-full h-full p-1.5 flex flex-col justify-center" style={{ background: theme.background }}>
              <div className="text-[6.5px] leading-tight line-clamp-3 font-medium" style={{ color: theme.text }}>
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
