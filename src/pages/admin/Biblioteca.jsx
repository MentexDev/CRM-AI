import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Library,
  Loader2,
  Search,
  LayoutGrid,
  List as ListIcon,
  Sparkles,
  ListTodo,
  FileText,
  Image as ImageIcon,
  Video,
  File,
  Files,
  TrendingUp,
  Clock,
  HardDrive,
  Copy,
  Check,
} from 'lucide-react'
import toast from 'react-hot-toast'
import EmptyState from '../../components/EmptyState'
import Modal from '../../components/Modal'
import { useLibraryAssets } from '../../hooks/useLibraryAssets'
import { useAgents } from '../../hooks/useAgents'
import { formatBytes, formatTimeAgo } from '../../lib/format'

const KIND_META = {
  campaign: { label: 'Campaña', icon: Sparkles, color: 'text-emerald-300', dot: 'bg-emerald-400' },
  task: { label: 'Tarea', icon: ListTodo, color: 'text-sky-300', dot: 'bg-sky-400' },
  document: { label: 'Documento', icon: FileText, color: 'text-sky-300', dot: 'bg-sky-400' },
  image: { label: 'Imagen', icon: ImageIcon, color: 'text-pink-300', dot: 'bg-pink-400' },
  video: { label: 'Video', icon: Video, color: 'text-rose-300', dot: 'bg-rose-400' },
  pdf: { label: 'PDF', icon: FileText, color: 'text-orange-300', dot: 'bg-orange-400' },
  other: { label: 'Otro', icon: File, color: 'text-nina-mute', dot: 'bg-nina-mute' },
}
const kindMeta = (k) => KIND_META[k] ?? KIND_META.other

export default function Biblioteca() {
  const { assets, loading } = useLibraryAssets()
  const { agents } = useAgents()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState({ kind: null, agentId: null }) // null = todos
  const [view, setView] = useState('grid')
  const [selected, setSelected] = useState(null)

  const agentsById = useMemo(() => {
    const m = {}
    for (const a of agents) m[a.id] = a
    return m
  }, [agents])

  const sourceLabel = (a) => agentsById[a.agent_id]?.name ?? 'Agente'

  // ── KPIs ──────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const weekAgo = Date.now() - 7 * 86400 * 1000
    const thisWeek = assets.filter((a) => new Date(a.created_at).getTime() > weekAgo).length
    const bytes = assets.reduce((acc, a) => acc + (a.size_bytes || 0), 0)
    const last = assets[0]?.created_at
    return { total: assets.length, thisWeek, bytes, last }
  }, [assets])

  // ── Conteos por tipo / agente para el sidebar ─────────────────────
  const counts = useMemo(() => {
    const kind = {}
    const agent = {}
    for (const a of assets) {
      kind[a.kind] = (kind[a.kind] || 0) + 1
      if (a.agent_id) agent[a.agent_id] = (agent[a.agent_id] || 0) + 1
    }
    return { kind, agent }
  }, [assets])

  // ── Filtrado client-side ──────────────────────────────────────────
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return assets.filter((a) => {
      if (filter.kind && a.kind !== filter.kind) return false
      if (filter.agentId && a.agent_id !== filter.agentId) return false
      if (q && !(`${a.title} ${a.content ?? ''}`.toLowerCase().includes(q))) return false
      return true
    })
  }, [assets, search, filter])

  if (loading) {
    return (
      <div className="grid place-items-center py-24 text-nina-mute">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    )
  }

  if (assets.length === 0) {
    return (
      <div className="lg:px-6 lg:pt-4">
        <EmptyState
          icon={Library}
          title="Biblioteca vacía"
          description="Aquí vivirá el contenido que producen los agentes: campañas, y más adelante imágenes, videos y piezas. Aparecerá aquí en cuanto los agentes lo generen."
        />
      </div>
    )
  }

  const kindsPresent = Object.keys(counts.kind)
  const agentsPresent = agents.filter((a) => counts.agent[a.id])

  return (
    <div className="space-y-5 lg:px-6 lg:pt-4">
      {/* Header */}
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-display text-2xl silver-text mb-1 flex items-center gap-2">
            <Library className="w-5 h-5 text-nina-silver" /> Biblioteca
          </h2>
          <p className="text-sm text-nina-mute">
            Campañas y contenido producido por los agentes.
          </p>
        </div>
      </header>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Total assets" value={stats.total} sub="en biblioteca" icon={Files} />
        <Kpi label="Esta semana" value={`+${stats.thisWeek}`} sub="nuevos" icon={TrendingUp} accent />
        <Kpi label="Última actividad" value={stats.last ? formatTimeAgo(stats.last) : '—'} sub="reciente" icon={Clock} />
        <Kpi label="Almacenamiento" value={formatBytes(stats.bytes)} sub="texto generado" icon={HardDrive} />
      </div>

      {/* Cuerpo: filtros | contenido */}
      <div className="flex flex-col lg:flex-row gap-4 items-start">
        {/* Sidebar filtros */}
        <aside className="w-full lg:w-52 shrink-0 panel p-2 space-y-0.5">
          <FilterRow
            label="Todos"
            count={assets.length}
            icon={Library}
            active={!filter.kind && !filter.agentId}
            onClick={() => setFilter({ kind: null, agentId: null })}
          />
          {kindsPresent.length > 0 && (
            <>
              <SectionLabel>Tipos</SectionLabel>
              {kindsPresent.map((k) => {
                const m = kindMeta(k)
                return (
                  <FilterRow
                    key={k}
                    label={m.label}
                    count={counts.kind[k]}
                    icon={m.icon}
                    active={filter.kind === k}
                    onClick={() => setFilter({ kind: filter.kind === k ? null : k, agentId: null })}
                  />
                )
              })}
            </>
          )}
          {agentsPresent.length > 0 && (
            <>
              <SectionLabel>Agentes</SectionLabel>
              {agentsPresent.map((a) => (
                <FilterRow
                  key={a.id}
                  label={a.name}
                  count={counts.agent[a.id]}
                  icon={Sparkles}
                  active={filter.agentId === a.id}
                  onClick={() => setFilter({ kind: null, agentId: filter.agentId === a.id ? null : a.id })}
                />
              ))}
            </>
          )}
        </aside>

        {/* Contenido */}
        <div className="flex-1 min-w-0 space-y-3">
          {/* Barra de búsqueda + toggle */}
          <div className="flex items-center gap-2">
            <div className="flex-1 flex items-center gap-2 px-3 h-10 rounded-xl bg-nina-ink border border-nina-line focus-within:border-nina-silver/40 transition">
              <Search className="w-4 h-4 text-nina-mute shrink-0" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por título o contenido…"
                className="flex-1 bg-transparent outline-none text-sm text-nina-chrome placeholder:text-nina-mute"
              />
            </div>
            <div className="flex items-center rounded-xl border border-nina-line overflow-hidden shrink-0">
              <ToggleBtn active={view === 'grid'} onClick={() => setView('grid')} title="Cuadrícula">
                <LayoutGrid className="w-4 h-4" />
              </ToggleBtn>
              <ToggleBtn active={view === 'list'} onClick={() => setView('list')} title="Lista">
                <ListIcon className="w-4 h-4" />
              </ToggleBtn>
            </div>
          </div>

          <div className="text-[12px] text-nina-mute">
            Mostrando {visible.length} de {assets.length} entregables
          </div>

          {visible.length === 0 ? (
            <div className="panel p-10 text-center text-nina-mute text-sm">
              Nada coincide con el filtro.
            </div>
          ) : view === 'grid' ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {visible.map((a) => (
                <AssetCard key={a.id} asset={a} sourceLabel={sourceLabel(a)} onOpen={() => setSelected(a)} />
              ))}
            </div>
          ) : (
            <div className="panel divide-y divide-nina-line/60 overflow-hidden">
              {visible.map((a) => (
                <AssetRow key={a.id} asset={a} sourceLabel={sourceLabel(a)} onOpen={() => setSelected(a)} />
              ))}
            </div>
          )}
        </div>
      </div>

      <AssetDetailModal
        asset={selected}
        sourceLabel={selected ? sourceLabel(selected) : ''}
        onClose={() => setSelected(null)}
      />
    </div>
  )
}

// ── Sub-componentes ─────────────────────────────────────────────────

function Kpi({ label, value, sub, icon: Icon, accent }) {
  return (
    <div className="panel p-4">
      <div className="flex items-start justify-between">
        <div className="w-8 h-8 rounded-lg grid place-items-center bg-nina-line/40 text-nina-silver">
          <Icon className="w-4 h-4" />
        </div>
        <span className="text-[10px] uppercase tracking-[0.2em] text-nina-mute">{label}</span>
      </div>
      <div className={`mt-3 font-display text-2xl ${accent ? 'text-emerald-300' : 'silver-text-static'}`}>
        {value}
      </div>
      <div className="text-[11px] text-nina-mute mt-0.5">{sub}</div>
    </div>
  )
}

function SectionLabel({ children }) {
  return (
    <div className="px-2 pt-3 pb-1 text-[10px] uppercase tracking-[0.2em] text-nina-mute">{children}</div>
  )
}

function FilterRow({ label, count, icon: Icon, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition ${
        active ? 'bg-nina-line/50 text-nina-chrome' : 'text-nina-mute hover:text-nina-chrome hover:bg-nina-line/25'
      }`}
    >
      <Icon className="w-4 h-4 shrink-0" />
      <span className="flex-1 min-w-0 truncate text-[13px]">{label}</span>
      <span className="text-[11px] text-nina-mute">{count}</span>
    </button>
  )
}

function ToggleBtn({ active, onClick, title, children }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`w-9 h-10 grid place-items-center transition ${
        active ? 'bg-nina-line/60 text-nina-chrome' : 'text-nina-mute hover:text-nina-chrome hover:bg-nina-line/30'
      }`}
    >
      {children}
    </button>
  )
}

function AssetCard({ asset, sourceLabel, onOpen }) {
  const m = kindMeta(asset.kind)
  const Icon = m.icon
  return (
    <motion.button
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={onOpen}
      className="panel overflow-hidden text-left group hover:border-nina-silver/30 transition"
    >
      {/* Preview del contenido (vista de lo que hay adentro) */}
      <div className="aspect-[4/3] relative overflow-hidden bg-nina-ink/50 border-b border-nina-line/40">
        <span className="absolute top-2 left-2 z-10 chip !px-2 !py-0.5 text-[10px] bg-nina-ink/80 border-nina-line text-nina-mute">
          {m.label}
        </span>
        {asset.content ? (
          <div
            className="absolute inset-0 px-3 pt-9 pb-2 text-[8.5px] leading-[1.5] text-nina-mute/70 whitespace-pre-wrap overflow-hidden group-hover:text-nina-mute transition-colors"
            style={{
              maskImage: 'linear-gradient(to bottom, black 55%, transparent)',
              WebkitMaskImage: 'linear-gradient(to bottom, black 55%, transparent)',
            }}
          >
            {asset.content}
          </div>
        ) : (
          <div className="absolute inset-0 grid place-items-center">
            <Icon className={`w-8 h-8 ${m.color} opacity-70`} />
          </div>
        )}
      </div>
      <div className="p-2.5 space-y-1">
        <div className="text-[12px] text-nina-chrome font-medium line-clamp-2 leading-snug">{asset.title}</div>
        <div className="flex items-center gap-1 text-[10px] text-nina-mute">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${m.dot}`} />
          <span className="truncate">{sourceLabel}</span>
          <span className="shrink-0">·</span>
          <span className="shrink-0">{formatTimeAgo(asset.created_at)}</span>
        </div>
      </div>
    </motion.button>
  )
}

function AssetRow({ asset, sourceLabel, onOpen }) {
  const m = kindMeta(asset.kind)
  const Icon = m.icon
  return (
    <button onClick={onOpen} className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-nina-line/25 transition">
      <div className="w-8 h-8 rounded-lg grid place-items-center bg-nina-line/40 shrink-0">
        <Icon className={`w-4 h-4 ${m.color}`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] text-nina-chrome truncate">{asset.title}</div>
        <div className="text-[11px] text-nina-mute truncate">{m.label} · {sourceLabel}</div>
      </div>
      <span className="text-[11px] text-nina-mute shrink-0">{formatBytes(asset.size_bytes)}</span>
      <span className="text-[11px] text-nina-mute shrink-0 w-20 text-right">{formatTimeAgo(asset.created_at)}</span>
    </button>
  )
}

function AssetDetailModal({ asset, sourceLabel, onClose }) {
  const [copied, setCopied] = useState(false)
  if (!asset) return null
  const m = kindMeta(asset.kind)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(asset.content || '')
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('No se pudo copiar')
    }
  }

  return (
    <Modal open={Boolean(asset)} onClose={onClose} title={asset.title} maxWidth="max-w-2xl">
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-[11px] text-nina-mute flex-wrap">
          <span className={`chip !px-2 !py-0.5 ${m.color} border-nina-line bg-nina-ink/60`}>{m.label}</span>
          <span>·</span>
          <span>{sourceLabel}</span>
          <span>·</span>
          <span>{formatBytes(asset.size_bytes)}</span>
          <span>·</span>
          <span>{formatTimeAgo(asset.created_at)}</span>
        </div>

        {asset.content ? (
          <div className="max-h-[52vh] overflow-y-auto rounded-lg border border-nina-line bg-nina-ink/40 px-3 py-2.5 text-[13px] text-nina-chrome whitespace-pre-wrap leading-relaxed">
            {asset.content}
          </div>
        ) : (
          <div className="text-sm text-nina-mute">Sin contenido de texto.</div>
        )}

        <div className="flex justify-end">
          <button onClick={copy} className="btn-ghost text-sm flex items-center gap-1.5">
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Copiado' : 'Copiar'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
