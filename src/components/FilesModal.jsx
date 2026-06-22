// Modal "Archivos de la conversación" (estilo NeuralOS) — se abre con el botón "Files" del header
// del chat. Agrega TODOS los archivos del hilo: artefactos creados por el agente (documentos, slides,
// hojas, pizarras, PDF, imágenes, correos), los ADJUNTOS subidos, y los ENLACES (URLs) mencionados.
// Búsqueda + filtros por categoría + vista lista/grid + estado vacío. Click en un archivo = abrirlo.
import { useEffect, useMemo, useState } from 'react'
import { Code2, FileText, FolderOpen, Image as ImageIcon, LayoutGrid, Link as LinkIcon, List, Search, X } from 'lucide-react'

const CATS = [
  { id: 'todo', label: 'Todo' },
  { id: 'documento', label: 'Documentos' },
  { id: 'multimedia', label: 'Multimedia' },
  { id: 'codigo', label: 'Archivos de código' },
  { id: 'enlace', label: 'Enlaces' },
]
const catIcon = (c) => (c === 'multimedia' ? ImageIcon : c === 'codigo' ? Code2 : c === 'enlace' ? LinkIcon : FileText)

export default function FilesModal({ files = [], onClose }) {
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('todo')
  const [grid, setGrid] = useState(false)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const counts = useMemo(() => {
    const c = {}
    for (const f of files) c[f.category] = (c[f.category] || 0) + 1
    return c
  }, [files])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return files.filter((f) => (cat === 'todo' || f.category === cat) && (!needle || f.name.toLowerCase().includes(needle)))
  }, [files, q, cat])

  const open = (f) => { f.open?.(); onClose() }

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 sm:pt-[8vh] bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-2xl max-h-[82vh] flex flex-col rounded-2xl border border-nina-line bg-nina-panel shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-nina-line/60 shrink-0">
          <span className="w-9 h-9 grid place-items-center rounded-xl bg-violet-500/15 text-violet-300 shrink-0"><FolderOpen className="w-5 h-5" /></span>
          <div className="text-[14px] font-semibold text-nina-chrome">Archivos de la conversación</div>
          <span className="text-[12px] text-nina-mute shrink-0 ml-1">· {files.length ? `${files.length} archivo${files.length > 1 ? 's' : ''}` : 'sin archivos'}</span>
          <div className="flex-1" />
          <button onClick={onClose} aria-label="Cerrar" className="w-8 h-8 grid place-items-center rounded-lg text-nina-mute hover:text-nina-chrome hover:bg-nina-line/40 shrink-0"><X className="w-4 h-4" /></button>
        </div>

        {/* Búsqueda */}
        <div className="px-4 pt-3 shrink-0">
          <div className="flex items-center gap-2 rounded-xl border border-nina-line bg-nina-ink px-3 py-2.5">
            <Search className="w-4 h-4 text-nina-mute shrink-0" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar archivos…" className="flex-1 bg-transparent text-[13px] text-nina-chrome placeholder:text-nina-mute/60 outline-none" />
          </div>
        </div>

        {/* Filtros por categoría + vista */}
        <div className="flex items-center gap-2 px-4 py-3 shrink-0 overflow-x-auto">
          {CATS.map((c) => {
            const on = cat === c.id
            const n = c.id === 'todo' ? files.length : (counts[c.id] || 0)
            return (
              <button
                key={c.id}
                onClick={() => setCat(c.id)}
                className={`px-3 py-1.5 rounded-lg text-[12.5px] whitespace-nowrap transition shrink-0 border ${on ? 'border-violet-400/70 text-nina-chrome bg-violet-500/10' : 'border-transparent text-nina-mute hover:text-nina-chrome hover:bg-nina-line/30'}`}
              >
                {c.label}{c.id !== 'todo' && n > 0 ? ` · ${n}` : ''}
              </button>
            )
          })}
          <div className="flex-1" />
          <div className="flex items-center gap-0.5 rounded-lg border border-nina-line p-0.5 shrink-0">
            <button onClick={() => setGrid(false)} aria-label="Vista lista" className={`w-7 h-7 grid place-items-center rounded ${!grid ? 'bg-nina-line/50 text-nina-chrome' : 'text-nina-mute hover:text-nina-chrome'}`}><List className="w-4 h-4" /></button>
            <button onClick={() => setGrid(true)} aria-label="Vista cuadrícula" className={`w-7 h-7 grid place-items-center rounded ${grid ? 'bg-nina-line/50 text-nina-chrome' : 'text-nina-mute hover:text-nina-chrome'}`}><LayoutGrid className="w-4 h-4" /></button>
          </div>
        </div>

        {/* Cuerpo */}
        <div className="flex-1 min-h-0 overflow-auto px-4 pb-3">
          {filtered.length === 0 ? (
            <div className="h-full min-h-[260px] flex flex-col items-center justify-center text-center px-6">
              <span className="w-14 h-14 grid place-items-center rounded-full bg-nina-line/30 text-nina-mute mb-4"><Search className="w-6 h-6" /></span>
              <div className="text-[15px] font-semibold text-nina-chrome mb-1">{files.length ? 'Sin resultados' : 'Aún no hay archivos'}</div>
              <div className="text-[12.5px] text-nina-mute max-w-xs leading-relaxed">{files.length ? 'Prueba con otra búsqueda o filtro.' : 'Los archivos que crees o adjuntes en esta conversación aparecerán aquí automáticamente.'}</div>
            </div>
          ) : grid ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {filtered.map((f) => {
                const I = catIcon(f.category)
                return (
                  <button key={f.id} onClick={() => open(f)} className="flex flex-col items-start gap-2 p-3 rounded-xl border border-nina-line/70 bg-nina-ink hover:border-nina-silver/50 hover:bg-nina-line/20 transition text-left">
                    <span className="w-9 h-9 grid place-items-center rounded-lg bg-nina-line/40 text-nina-silver"><I className="w-4 h-4" /></span>
                    <div className="min-w-0 w-full"><div className="text-[12.5px] text-nina-chrome truncate">{f.name}</div><div className="text-[10.5px] text-nina-mute truncate">{f.sub}</div></div>
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="space-y-1">
              {filtered.map((f) => {
                const I = catIcon(f.category)
                return (
                  <button key={f.id} onClick={() => open(f)} className="w-full flex items-center gap-3 px-2.5 py-2 rounded-lg hover:bg-nina-line/30 transition text-left">
                    <span className="w-8 h-8 grid place-items-center rounded-lg bg-nina-line/40 text-nina-silver shrink-0"><I className="w-4 h-4" /></span>
                    <div className="min-w-0 flex-1"><div className="text-[13px] text-nina-chrome truncate">{f.name}</div><div className="text-[11px] text-nina-mute truncate">{f.sub}</div></div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-nina-line/60 shrink-0 text-[11.5px] text-nina-mute">
          <span>Click en un archivo para abrirlo</span>
          <span className="flex items-center gap-1.5"><kbd className="px-1.5 py-0.5 rounded bg-nina-line/50 text-[10px] font-sans">ESC</kbd> cerrar</span>
        </div>
      </div>
    </div>
  )
}
