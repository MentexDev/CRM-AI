import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle, ArrowUp, CheckCircle2, ChevronLeft, ChevronRight, Download, ExternalLink, Save, Sparkles, Trash2, X } from 'lucide-react'

// Visor grande de imágenes (lightbox) estilo NeuralOS Image Studio. Overlay full-screen con
// navegación ◀▶ entre todas las imágenes de la galería, barra de acciones (Descargar, Guardar en
// Biblioteca, Exportar al canvas) y un composer "Describe los cambios…" que dispara una VARIACIÓN
// (re-genera con nano-banana usando la imagen como referencia). Toda la lógica de red vive en el
// padre (Agents.jsx); aquí solo UI + callbacks. Se renderiza en un portal para cubrir todo.
export default function ImageLightbox({ images = [], activeKey, onClose, onSelect, onDownload, onSave, onExport, onVariation, onDelete, savedKeys, sending }) {
  const idx = images.findIndex((i) => i.key === activeKey)
  const current = idx >= 0 ? images[idx] : null
  const [instruction, setInstruction] = useState('')
  const taRef = useRef(null)

  useEffect(() => { setInstruction('') }, [activeKey])
  // Auto-crecer el textarea con el contenido, hasta 3 renglones (luego scrollea).
  useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 72) + 'px'
  }, [instruction])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { onClose?.(); return } // ESC siempre cierra (también desde el textarea)
      if (e.target?.tagName === 'TEXTAREA') return // no navegar con ←→ mientras se escribe la variación
      if (e.key === 'ArrowLeft') step(-1)
      else if (e.key === 'ArrowRight') step(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, images.length])

  if (!current) return null
  const saved = savedKeys?.has?.(current.key)

  function step(delta) {
    if (images.length < 2) return
    const next = (idx + delta + images.length) % images.length
    onSelect?.(images[next].key)
  }
  const submit = () => {
    const t = instruction.trim()
    if (!t || sending) return
    onVariation?.(current, t)
  }
  const btn = 'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] text-white/80 hover:text-white hover:bg-white/10 transition disabled:opacity-50 shrink-0'

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="absolute inset-0 z-40 bg-black/90 backdrop-blur-sm flex flex-col"
      onClick={onClose}
    >
      {/* Barra superior: contador + acciones */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 shrink-0" onClick={(e) => e.stopPropagation()}>
        <div className="text-[12.5px] text-white/60 truncate">
          {idx + 1} / {images.length}{current.prompt ? ` · ${String(current.prompt).slice(0, 70)}` : ''}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => onDownload?.(current)} className={btn} title="Descargar"><Download className="w-4 h-4" /><span className="hidden sm:inline">Descargar</span></button>
          <button onClick={() => onSave?.(current)} disabled={saved} className={btn} title={saved ? 'Ya está en la biblioteca' : 'Guardar en la biblioteca'}>
            {saved ? <CheckCircle2 className="w-4 h-4 text-emerald-300" /> : <Save className="w-4 h-4" />}<span className="hidden sm:inline">{saved ? 'Guardado' : 'Guardar'}</span>
          </button>
          <button onClick={() => onExport?.(current)} className={btn} title="Abrir en una pestaña del canvas"><ExternalLink className="w-4 h-4" /><span className="hidden sm:inline">Exportar</span></button>
          {onDelete && <button onClick={() => onDelete(current)} className={`${btn} hover:text-red-300 hover:bg-red-500/10`} title="Eliminar imagen"><Trash2 className="w-4 h-4" /></button>}
          <button onClick={onClose} className={`${btn} ml-1`} title="Cerrar (Esc)"><X className="w-4 h-4" /></button>
        </div>
      </div>

      {/* Imagen + flechas (flotan SOBRE la imagen, a los lados → visibles también en 16:9) */}
      <div className="relative flex-1 min-h-0 flex items-center justify-center px-3 sm:px-16" onClick={(e) => e.stopPropagation()}>
        <img src={current.url} alt={current.prompt || 'Imagen'} referrerPolicy="no-referrer" className="max-h-full max-w-full object-contain rounded-lg shadow-2xl" />
        {images.length > 1 && (
          <>
            <button onClick={() => step(-1)} className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 z-10 w-11 h-11 grid place-items-center rounded-full bg-black/60 hover:bg-black/80 border border-white/15 text-white shadow-lg transition" title="Anterior (←)"><ChevronLeft className="w-6 h-6" /></button>
            <button onClick={() => step(1)} className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 z-10 w-11 h-11 grid place-items-center rounded-full bg-black/60 hover:bg-black/80 border border-white/15 text-white shadow-lg transition" title="Siguiente (→)"><ChevronRight className="w-6 h-6" /></button>
          </>
        )}
      </div>

      {/* Aviso si las referencias no se aplicaron (no presentar como producto real) */}
      {current.warning && (
        <div className="mx-auto mt-2 max-w-2xl px-3 py-1.5 rounded-lg bg-amber-500/15 border border-amber-400/30 text-[11.5px] text-amber-200 flex items-start gap-1.5" onClick={(e) => e.stopPropagation()}>
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /><span>{current.warning}</span>
        </div>
      )}

      {/* Composer de variación */}
      <div className="shrink-0 px-4 pb-4 pt-2" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto max-w-2xl flex items-end gap-2 rounded-2xl border border-nina-line bg-nina-ink px-3 py-2.5 shadow-xl">
          <Sparkles className="w-4 h-4 text-nina-silver shrink-0 mb-1.5" />
          <textarea
            ref={taRef}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }}
            rows={1}
            placeholder="Describe los cambios a aplicar… (variación con Nano Banana)"
            className="flex-1 bg-transparent text-[13px] text-nina-chrome placeholder:text-nina-mute/70 outline-none resize-none leading-relaxed min-h-[24px] max-h-[72px]"
          />
          <button onClick={submit} disabled={!instruction.trim() || sending} className="!p-2 h-9 w-9 grid place-items-center rounded-xl btn-primary disabled:opacity-40 shrink-0 transition" title="Generar variación">
            <ArrowUp className="w-4 h-4" />
          </button>
        </div>
      </div>
    </motion.div>
  )
}
