// Command palette del workspace (estilo NeuralOS): se abre con el "+" de las pestañas.
// "Empezar algo nuevo" + un input para describir lo que necesitas (lo manda al agente).
// Las funciones que aún no existen salen como "Próximamente" (deshabilitadas) — honesto.
import { useEffect, useState } from 'react'
import {
  CalendarDays, FileText, Globe, Image as ImageIcon, LayoutGrid, Mail,
  Presentation, Search, Sparkles, Table, X,
} from 'lucide-react'

const NEW_ITEMS = [
  { id: 'document', label: 'Documento', desc: 'Editor estilo Notion', icon: FileText, active: true },
  { id: 'email', label: 'Correo', desc: 'Campaña HTML responsiva', icon: Mail, active: true },
  { id: 'image', label: 'Imagen', desc: 'Genérala con IA', icon: ImageIcon, active: true },
  { id: 'calendar', label: 'Agendar', desc: 'Programar contenido', icon: CalendarDays, active: true },
  { id: 'slides', label: 'Presentación', desc: 'Mazo de diapositivas con IA', icon: Presentation, active: true },
  { id: 'sheet', label: 'Hoja de cálculo', desc: 'Tabla de datos con totales', icon: Table, active: true },
  { id: 'web', label: 'Navegar web', desc: 'Próximamente', icon: Globe, active: false },
  { id: 'board', label: 'Pizarra', desc: 'Próximamente', icon: LayoutGrid, active: false },
]

// Prompts de arranque para las acciones que dispara el agente (usa ask_questions y precisa).
// Prompts NATURALES (sin mencionar tools): el formulario de preguntas se garantiza forzando
// ask_questions a nivel del LLM (force_tool), no diciéndoselo al agente en el texto.
const AGENT_PROMPTS = {
  email: 'Hoy quiero crear un correo.',
  image: 'Hoy quiero crear una imagen.',
  calendar: 'Hoy quiero agendar algo en el calendario.',
  slides: 'Hoy quiero crear una presentación.',
  sheet: 'Hoy quiero crear una hoja de cálculo.',
}

export default function CommandPalette({ open, onClose, onNewDocument, onAgentPrompt }) {
  const [q, setQ] = useState('')

  useEffect(() => {
    if (!open) { setQ(''); return }
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const pick = (item) => {
    if (!item.active) return
    if (item.id === 'document') return onNewDocument()
    // Forzamos ask_questions en el primer turno → aparece el formulario, no preguntas en texto.
    onAgentPrompt(AGENT_PROMPTS[item.id] || item.label, 'ask_questions')
  }
  const submitDescribe = () => {
    const t = q.trim()
    if (t) onAgentPrompt(t)
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center pt-[12vh] px-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-[min(640px,94vw)] rounded-2xl border border-nina-line bg-nina-panel shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 px-4 py-3.5 border-b border-nina-line/60">
          <Search className="w-4 h-4 text-nina-mute shrink-0" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submitDescribe() }}
            placeholder="Pega una URL o describe lo que necesitas…"
            className="flex-1 bg-transparent outline-none text-nina-chrome text-[14.5px] placeholder:text-nina-mute/60"
          />
          <button onClick={onClose} className="text-nina-mute hover:text-nina-chrome shrink-0" aria-label="Cerrar">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4">
          <div className="text-[10.5px] uppercase tracking-[0.18em] text-nina-silver mb-2.5 flex items-center gap-1.5">
            <Sparkles className="w-3 h-3" /> Empezar algo nuevo
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {NEW_ITEMS.map((it) => {
              const Icon = it.icon
              return (
                <button
                  key={it.id}
                  onClick={() => pick(it)}
                  disabled={!it.active}
                  title={it.active ? it.label : 'Próximamente'}
                  className={`text-left rounded-xl border p-3 transition ${
                    it.active
                      ? 'border-nina-line hover:border-nina-silver/50 hover:bg-nina-line/20'
                      : 'border-nina-line/40 opacity-45 cursor-not-allowed'
                  }`}
                >
                  <Icon className="w-5 h-5 text-nina-silver mb-2" />
                  <div className="text-[13px] text-nina-chrome font-medium">{it.label}</div>
                  <div className="text-[10.5px] text-nina-mute mt-0.5 leading-tight">{it.desc}</div>
                </button>
              )
            })}
          </div>
        </div>

        <div className="px-4 py-2.5 border-t border-nina-line/40 text-[10.5px] text-nina-mute flex items-center gap-4">
          <span><kbd className="px-1 py-0.5 rounded bg-nina-line/50 text-nina-chrome">↵</kbd> describe y envía al agente</span>
          <span><kbd className="px-1 py-0.5 rounded bg-nina-line/50 text-nina-chrome">Esc</kbd> cerrar</span>
        </div>
      </div>
    </div>
  )
}
