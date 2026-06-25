// Sección "Plantillas Code" — galería de plantillas de trabajo (estilo Notion Marketplace / Biblioteca)
// que crea el agente Code. Replica el diseño de Biblioteca: filtros por categoría + búsqueda + grid de
// tarjetas con preview. Abrir una plantilla muestra su contenido y permite descargarla o ir a Code.
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Download, Layers, LayoutTemplate, Loader2, Search, Sparkles } from 'lucide-react'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'
import { useCodeTemplates } from '../../hooks/useCodeTemplates'
import { artifactToFile, coverBg, kindMeta } from '../../lib/artifactKinds'
import { formatTimeAgo } from '../../lib/format'
import Modal from '../../components/Modal'
import EmptyState from '../../components/EmptyState'
import { TemplateBody, previewText } from '../../components/artifacts/TemplateRenderer'

export default function Plantillas() {
  const { templates, loading } = useCodeTemplates()
  const [search, setSearch] = useState('')
  const [cat, setCat] = useState(null)
  const [selected, setSelected] = useState(null)

  const categories = useMemo(() => {
    const c = {}
    for (const t of templates) { const k = t.category || 'Otras'; c[k] = (c[k] || 0) + 1 }
    return c
  }, [templates])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return templates.filter((t) => {
      if (cat && (t.category || 'Otras') !== cat) return false
      if (!q) return true
      return (t.title || '').toLowerCase().includes(q) || (t.category || '').toLowerCase().includes(q) || previewText(t).toLowerCase().includes(q)
    })
  }, [templates, search, cat])

  if (loading) {
    return (
      <div className="lg:px-6 lg:pt-4 flex items-center justify-center py-20 text-nina-mute">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    )
  }

  if (templates.length === 0) {
    return (
      <div className="lg:px-6 lg:pt-4">
        <EmptyState
          icon={LayoutTemplate}
          title="Aún no hay plantillas"
          description="Aquí vivirán las plantillas de trabajo que crea el agente Code (tableros, trackers, calendarios, dashboards…). Pídele a Code una plantilla y guárdala aquí."
        />
      </div>
    )
  }

  return (
    <div className="space-y-5 lg:px-6 lg:pt-4">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-display text-2xl silver-text mb-1 flex items-center gap-2">
            <LayoutTemplate className="w-5 h-5 text-nina-silver" /> Plantillas Code
          </h2>
          <p className="text-sm text-nina-mute">Plantillas de trabajo reutilizables creadas por el agente Code.</p>
        </div>
      </header>

      <div className="flex flex-col lg:flex-row gap-4 items-start">
        {/* Filtros por categoría */}
        <aside className="w-full lg:w-52 shrink-0 panel p-2 space-y-0.5">
          <CatRow label="Todas" count={templates.length} icon={Layers} active={!cat} onClick={() => setCat(null)} />
          <div className="px-2 pt-3 pb-1 text-[10px] uppercase tracking-[0.2em] text-nina-mute">Categorías</div>
          {Object.keys(categories).sort().map((k) => (
            <CatRow key={k} label={k} count={categories[k]} icon={Sparkles} active={cat === k} onClick={() => setCat(cat === k ? null : k)} />
          ))}
        </aside>

        {/* Grid */}
        <div className="flex-1 min-w-0 space-y-3">
          <div className="flex-1 flex items-center gap-2 px-3 h-10 rounded-xl bg-nina-ink border border-nina-line focus-within:border-nina-silver/40 transition">
            <Search className="w-4 h-4 text-nina-mute shrink-0" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar plantilla por nombre, categoría o contenido…"
              className="flex-1 bg-transparent outline-none text-sm text-nina-chrome placeholder:text-nina-mute"
            />
          </div>
          <div className="text-[12px] text-nina-mute">Mostrando {visible.length} de {templates.length} plantillas</div>

          {visible.length === 0 ? (
            <div className="panel p-10 text-center text-nina-mute text-sm">Nada coincide con el filtro.</div>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
              {visible.map((t) => (
                <TemplateCard key={t.id} t={t} onOpen={() => setSelected(t)} />
              ))}
            </div>
          )}
        </div>
      </div>

      <TemplateDetail t={selected} onClose={() => setSelected(null)} />
    </div>
  )
}

function TemplateCard({ t, onOpen }) {
  const m = kindMeta(t.kind)
  return (
    <motion.button
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={onOpen}
      className="panel overflow-hidden text-left group hover:border-nina-silver/30 transition"
    >
      {/* Preview RENDERIZADO (igual que al abrirla) o portada */}
      <div className="aspect-[4/3] relative overflow-hidden bg-nina-panel/40 border-b border-nina-line/40">
        <span className={`absolute top-2 left-2 z-20 chip !px-2 !py-0.5 text-[10px] bg-nina-ink/80 border-nina-line ${m.color}`}>{m.label}</span>
        {t.cover_url ? (
          <div className="absolute inset-0" style={{ background: coverBg(t.cover_url) }} />
        ) : (
          <div
            className="absolute inset-0 overflow-hidden pointer-events-none"
            style={{ maskImage: 'linear-gradient(to bottom, black 62%, transparent)', WebkitMaskImage: 'linear-gradient(to bottom, black 62%, transparent)' }}
          >
            <div className="absolute top-0 left-0 origin-top-left scale-[0.6] w-[167%] p-3 pt-9">
              <TemplateBody t={t} mini />
            </div>
          </div>
        )}
      </div>
      <div className="p-2.5 space-y-1">
        <div className="text-[12.5px] text-nina-chrome font-medium line-clamp-2 leading-snug">{t.title}</div>
        <div className="flex items-center gap-1 text-[10px] text-nina-mute">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${m.dot}`} />
          <span className="truncate">{t.category || 'Otras'}</span>
          <span className="shrink-0">·</span>
          <span className="shrink-0">{formatTimeAgo(t.created_at)}</span>
        </div>
      </div>
    </motion.button>
  )
}

function TemplateDetail({ t, onClose }) {
  const navigate = useNavigate()
  if (!t) return null
  const m = kindMeta(t.kind)
  const d = t.data || {}

  const download = () => {
    const f = artifactToFile({ type: t.kind, ...d, title: t.title })
    if (f.url) { window.open(f.url, '_blank', 'noreferrer'); return }
    const el = document.createElement('a')
    el.href = URL.createObjectURL(new Blob([f.text], { type: `${f.mime};charset=utf-8` }))
    el.download = f.name
    el.click()
    setTimeout(() => URL.revokeObjectURL(el.href), 1000)
    toast.success('Descargada')
  }

  return (
    <Modal open={Boolean(t)} onClose={onClose} title={t.title} maxWidth="max-w-3xl">
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-[11px] text-nina-mute flex-wrap">
          <span className={`chip !px-2 !py-0.5 ${m.color} border-nina-line bg-nina-ink/60`}>{m.label}</span>
          <span>·</span>
          <span>{t.category || 'Otras'}</span>
          <span>·</span>
          <span>generada por Code</span>
        </div>

        {/* Contenido (mismo render que la tarjeta) */}
        <div className="rounded-xl border border-nina-line bg-nina-ink/40 p-4 max-h-[55vh] overflow-y-auto">
          <TemplateBody t={t} />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={download} className="btn-ghost text-sm flex items-center gap-1.5"><Download className="w-4 h-4" /> Descargar</button>
          <button
            onClick={() =>
              navigate(
                t.source_conversation_id && t.source_artifact_key
                  ? `/admin/agentes/code?c=${t.source_conversation_id}&tab=${encodeURIComponent(t.source_artifact_key)}`
                  : '/admin/agentes/code',
              )
            }
            className="btn-primary text-sm flex items-center gap-1.5"
          >
            <Sparkles className="w-4 h-4" /> Abrir en Code
          </button>
        </div>
      </div>
    </Modal>
  )
}

function CatRow({ label, count, icon: Icon, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition ${active ? 'bg-nina-line/50 text-nina-chrome' : 'text-nina-mute hover:text-nina-chrome hover:bg-nina-line/25'}`}
    >
      <Icon className="w-4 h-4 shrink-0" />
      <span className="flex-1 min-w-0 truncate text-[13px]">{label}</span>
      <span className="text-[11px] text-nina-mute">{count}</span>
    </button>
  )
}
