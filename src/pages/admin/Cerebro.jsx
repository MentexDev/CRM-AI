import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Brain,
  Search,
  Loader2,
  FileText,
  Globe,
  MessageSquare,
  BookOpen,
  Sparkles,
  Plus,
  RefreshCw,
  Activity,
  Database,
  Network,
  X,
} from 'lucide-react'
import toast from 'react-hot-toast'
import EmptyState from '../../components/EmptyState'
import Modal from '../../components/Modal'
import Select from '../../components/Select'
import { useBrands } from '../../hooks/useBrands'
import { useBrain } from '../../hooks/useBrain'
import { formatTimeAgo } from '../../lib/format'

// Metadatos de presentación por tipo de fuente del documento.
const SOURCE_META = {
  manual: { label: 'Manual', icon: FileText },
  markdown: { label: 'Markdown', icon: FileText },
  pdf: { label: 'PDF', icon: FileText },
  web: { label: 'Web', icon: Globe },
  conversation: { label: 'Conversación', icon: MessageSquare },
  obsidian: { label: 'Obsidian', icon: BookOpen },
  tool_result: { label: 'Herramienta', icon: Sparkles },
  distillation: { label: 'Aprendizaje', icon: Sparkles },
}
const sourceMeta = (k) => SOURCE_META[k] ?? SOURCE_META.manual

// Estado de ingesta de cada documento.
const STATUS_META = {
  ingested: { label: 'Listo', dot: 'bg-emerald-400', text: 'text-emerald-300' },
  ingesting: { label: 'Procesando', dot: 'bg-amber-400', text: 'text-amber-300' },
  pending: { label: 'En cola', dot: 'bg-sky-400', text: 'text-sky-300' },
  failed: { label: 'Error', dot: 'bg-rose-400', text: 'text-rose-300' },
  orphaned: { label: 'Huérfano', dot: 'bg-nina-mute', text: 'text-nina-mute' },
}
const statusMeta = (s) => STATUS_META[s] ?? STATUS_META.pending

const healthTone = (score) =>
  score == null ? 'silver-text-static' : score >= 80 ? 'text-emerald-300' : score >= 50 ? 'text-amber-300' : 'text-rose-300'

export default function Cerebro() {
  const { brands, loading: loadingBrands } = useBrands()
  const [brandId, setBrandId] = useState('')

  // Marca activa por defecto: la primera disponible.
  useEffect(() => {
    if (!brandId && brands.length > 0) setBrandId(brands[0].id)
  }, [brands, brandId])

  const brain = useBrain(brandId)
  const {
    documents,
    loadingDocs,
    health,
    results,
    searching,
    searchError,
    ingest,
    search,
    clearSearch,
    refresh,
  } = brain

  const [query, setQuery] = useState('')
  const [uploadOpen, setUploadOpen] = useState(false)

  const counts = health?.counts ?? { documents: documents.length, chunks: 0, entities: 0 }
  const score = health?.last_log?.health_score ?? null
  const brandName = useMemo(
    () => brands.find((b) => b.id === brandId)?.name ?? '',
    [brands, brandId],
  )

  const onSearch = (e) => {
    e.preventDefault()
    search(query)
  }

  if (loadingBrands) {
    return (
      <div className="grid place-items-center py-24 text-nina-mute">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    )
  }

  if (brands.length === 0) {
    return (
      <div className="lg:px-6 lg:pt-4">
        <EmptyState
          icon={Brain}
          title="No hay marcas todavía"
          description="El cerebro guarda el conocimiento por marca. Crea una marca primero para empezar a alimentarlo."
        />
      </div>
    )
  }

  return (
    <div className="space-y-5 lg:px-6 lg:pt-4">
      {/* Header */}
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-display text-2xl silver-text mb-1 flex items-center gap-2">
            <Brain className="w-5 h-5 text-nina-silver" /> Cerebro
          </h2>
          <p className="text-sm text-nina-mute">
            Conocimiento que los agentes consultan. Súbelo, búscalo y vigila su salud.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            className="w-44"
            value={brandId}
            onChange={(v) => setBrandId(v)}
            options={brands.map((b) => ({ value: b.id, label: b.name }))}
          />
          <button
            onClick={refresh}
            className="btn-ghost shrink-0"
            title="Actualizar"
            disabled={loadingDocs}
          >
            <RefreshCw className={`w-4 h-4 ${loadingDocs ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={() => setUploadOpen(true)} className="btn-primary shrink-0" disabled={!brandId}>
            <Plus className="w-4 h-4" /> Subir
          </button>
        </div>
      </header>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Documentos" value={counts.documents} sub="en el cerebro" icon={FileText} />
        <Kpi label="Fragmentos" value={counts.chunks} sub="vectorizados" icon={Database} />
        <Kpi label="Entidades" value={counts.entities} sub="en el grafo" icon={Network} />
        <Kpi
          label="Salud"
          value={score != null ? `${score}/100` : '—'}
          sub={health?.last_log ? formatTimeAgo(health.last_log.created_at) : 'sin datos'}
          icon={Activity}
          valueClass={healthTone(score)}
        />
      </div>

      {/* Cuerpo: principal (buscar + documentos) | salud */}
      <div className="grid lg:grid-cols-3 gap-4 items-start">
        <div className="lg:col-span-2 space-y-4 min-w-0">
          {/* Buscar */}
          <section className="space-y-3">
            <form onSubmit={onSearch} className="flex items-center gap-2">
              <div className="flex-1 flex items-center gap-2 px-3 h-10 rounded-xl bg-nina-ink border border-nina-line focus-within:border-nina-silver/40 transition">
                <Search className="w-4 h-4 text-nina-mute shrink-0" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={`Pregúntale al cerebro de ${brandName || 'la marca'}…`}
                  className="flex-1 bg-transparent outline-none text-sm text-nina-chrome placeholder:text-nina-mute"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => {
                      setQuery('')
                      clearSearch()
                    }}
                    className="text-nina-mute hover:text-nina-chrome shrink-0"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              <button type="submit" className="btn-primary shrink-0" disabled={searching}>
                {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                Buscar
              </button>
            </form>

            {searchError && <div className="text-[12px] text-rose-300">{searchError}</div>}

            {results && <SearchResults results={results} />}
          </section>

          {/* Documentos */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs uppercase tracking-[0.2em] text-nina-mute">Documentos</h3>
              <span className="text-[11px] text-nina-mute">{documents.length}</span>
            </div>
            {loadingDocs && documents.length === 0 ? (
              <div className="grid place-items-center py-12 text-nina-mute">
                <Loader2 className="w-5 h-5 animate-spin" />
              </div>
            ) : documents.length === 0 ? (
              <EmptyState
                compact
                icon={Brain}
                title="El cerebro está vacío"
                description={`Sube el primer documento para que los agentes de ${brandName || 'la marca'} aprendan de él.`}
                actions={
                  <button onClick={() => setUploadOpen(true)} className="btn-primary" disabled={!brandId}>
                    <Plus className="w-4 h-4" /> Subir documento
                  </button>
                }
              />
            ) : (
              <div className="panel divide-y divide-nina-line/60 overflow-hidden">
                {documents.map((d) => (
                  <DocumentRow key={d.id} doc={d} />
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Salud */}
        <aside className="min-w-0">
          <HealthPanel health={health} />
        </aside>
      </div>

      <IngestDocumentModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onIngest={ingest}
        brandName={brandName}
      />
    </div>
  )
}

// ── Sub-componentes ─────────────────────────────────────────────────

function Kpi({ label, value, sub, icon: Icon, valueClass = 'silver-text-static' }) {
  return (
    <div className="panel p-4">
      <div className="flex items-start justify-between">
        <div className="w-8 h-8 rounded-lg grid place-items-center bg-nina-line/40 text-nina-silver">
          <Icon className="w-4 h-4" />
        </div>
        <span className="text-[10px] uppercase tracking-[0.2em] text-nina-mute">{label}</span>
      </div>
      <div className={`mt-3 font-display text-2xl ${valueClass}`}>{value}</div>
      <div className="text-[11px] text-nina-mute mt-0.5">{sub}</div>
    </div>
  )
}

function DocumentRow({ doc }) {
  const sm = sourceMeta(doc.source_kind)
  const st = statusMeta(doc.status)
  const Icon = sm.icon
  return (
    <div className="w-full flex items-center gap-3 px-3 py-2.5">
      <div className="w-8 h-8 rounded-lg grid place-items-center bg-nina-line/40 shrink-0 text-nina-silver">
        <Icon className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] text-nina-chrome truncate">{doc.title || 'Sin título'}</div>
        <div className="text-[11px] text-nina-mute truncate">
          {sm.label}
          {doc.chunk_count ? ` · ${doc.chunk_count} fragmentos` : ''}
        </div>
      </div>
      <span className={`flex items-center gap-1.5 text-[11px] shrink-0 ${st.text}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
        {st.label}
      </span>
      <span className="text-[11px] text-nina-mute shrink-0 w-20 text-right">
        {formatTimeAgo(doc.created_at)}
      </span>
    </div>
  )
}

function SearchResults({ results }) {
  const { chunks = [], entities = [], stats } = results
  if (chunks.length === 0 && entities.length === 0) {
    return (
      <div className="panel p-6 text-center text-nina-mute text-sm">
        El cerebro no encontró nada para esa búsqueda.
      </div>
    )
  }
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-3"
    >
      {entities.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {entities.map((e) => (
            <span key={e.id} className="chip !px-2 !py-0.5 text-[11px] text-nina-chrome border-nina-line bg-nina-ink/60">
              <Network className="w-3 h-3 text-nina-silver" />
              {e.name}
              <span className="text-nina-mute">· {e.kind}</span>
            </span>
          ))}
        </div>
      )}
      {chunks.map((c) => (
        <div key={c.id} className="panel p-3 space-y-1.5">
          <div className="flex items-center justify-between gap-2 text-[11px] text-nina-mute">
            <span className="truncate">{c.document_title || 'Documento'}</span>
            <span className="chip !px-1.5 !py-0.5 text-[10px] text-emerald-300 border-nina-line bg-nina-ink/60 shrink-0">
              {Math.round((c.score ?? 0) * 100)}%
            </span>
          </div>
          <div className="text-[13px] text-nina-chrome whitespace-pre-wrap leading-relaxed line-clamp-6">
            {c.content}
          </div>
        </div>
      ))}
      {stats && (
        <div className="text-[11px] text-nina-mute">
          {stats.chunks_found} fragmentos · {stats.entities_found} entidades · {stats.total_ms} ms
        </div>
      )}
    </motion.div>
  )
}

function HealthBar({ label, value, total, tone }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-nina-mute">{label}</span>
        <span className="text-nina-chrome">{value}</span>
      </div>
      <div className="h-1.5 rounded-full bg-nina-line/40 overflow-hidden">
        <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function HealthPanel({ health }) {
  const log = health?.last_log
  const counts = health?.counts
  const score = log?.health_score ?? null

  return (
    <div className="panel p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Activity className="w-4 h-4 text-nina-silver" />
        <h3 className="text-xs uppercase tracking-[0.2em] text-nina-mute">Salud del cerebro</h3>
      </div>

      <div className="text-center py-2">
        <div className={`font-display text-4xl ${healthTone(score)}`}>
          {score != null ? score : '—'}
          {score != null && <span className="text-lg text-nina-mute">/100</span>}
        </div>
        <div className="text-[11px] text-nina-mute mt-1">
          {log ? `Último chequeo ${formatTimeAgo(log.created_at)}` : 'Aún sin chequeos del doctor'}
        </div>
      </div>

      {log ? (
        <div className="space-y-2.5">
          <HealthBar
            label="Fragmentos sin vector"
            value={log.chunks_missing_embedding ?? 0}
            total={log.chunks_total ?? 0}
            tone="bg-amber-400"
          />
          <HealthBar
            label="Fragmentos duplicados"
            value={log.chunks_duplicate ?? 0}
            total={log.chunks_total ?? 0}
            tone="bg-rose-400"
          />
          <HealthBar
            label="Documentos huérfanos"
            value={log.docs_orphaned ?? 0}
            total={log.docs_total ?? 0}
            tone="bg-nina-mute"
          />
        </div>
      ) : (
        <p className="text-[12px] text-nina-mute leading-snug">
          El doctor del cerebro corre cada hora y deja aquí su reporte (fragmentos sin
          vectorizar, duplicados y documentos huérfanos).
        </p>
      )}

      {counts && (
        <div className="pt-3 border-t border-nina-line/60 grid grid-cols-3 gap-2 text-center">
          <Mini label="Docs" value={counts.documents} />
          <Mini label="Chunks" value={counts.chunks} />
          <Mini label="Entidades" value={counts.entities} />
        </div>
      )}
    </div>
  )
}

function Mini({ label, value }) {
  return (
    <div>
      <div className="font-display text-lg silver-text-static">{value}</div>
      <div className="text-[10px] uppercase tracking-[0.15em] text-nina-mute">{label}</div>
    </div>
  )
}

const KIND_OPTIONS = [
  { value: 'manual', label: 'Manual (texto)' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'web', label: 'Página web (URL)' },
]

function IngestDocumentModal({ open, onClose, onIngest, brandName }) {
  const [mode, setMode] = useState('text') // 'text' | 'url'
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [url, setUrl] = useState('')
  const [sourceKind, setSourceKind] = useState('manual')
  const [busy, setBusy] = useState(false)

  const reset = () => {
    setMode('text')
    setTitle('')
    setContent('')
    setUrl('')
    setSourceKind('manual')
    setBusy(false)
  }

  const close = () => {
    if (busy) return
    reset()
    onClose()
  }

  const submit = async (e) => {
    e.preventDefault()
    const t = title.trim()
    if (!t) return toast.error('Ponle un título')
    if (mode === 'text' && !content.trim()) return toast.error('Escribe el contenido')
    if (mode === 'url' && !url.trim()) return toast.error('Pega una URL')

    setBusy(true)
    const toastId = toast.loading('Procesando en el cerebro…')
    try {
      const data = await onIngest({
        title: t,
        content: mode === 'text' ? content.trim() : undefined,
        sourceUrl: mode === 'url' ? url.trim() : undefined,
        sourceKind: mode === 'url' ? 'web' : sourceKind,
      })
      const n = data?.chunks_created ?? 0
      toast.success(`Ingestado · ${n} fragmento${n === 1 ? '' : 's'} creado${n === 1 ? '' : 's'}`, {
        id: toastId,
      })
      reset()
      onClose()
    } catch (err) {
      toast.error(err?.message || 'No se pudo ingestar', { id: toastId })
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={close} title="Subir al cerebro" maxWidth="max-w-xl">
      <form onSubmit={submit} className="space-y-4">
        <p className="text-[12px] text-nina-mute">
          Lo que subas se fragmenta, se vectoriza y queda disponible para los agentes de{' '}
          <span className="text-nina-chrome">{brandName || 'la marca'}</span>.
        </p>

        {/* Toggle texto / URL */}
        <div className="flex items-center rounded-xl border border-nina-line overflow-hidden w-fit">
          <ModeBtn active={mode === 'text'} onClick={() => setMode('text')}>
            Texto
          </ModeBtn>
          <ModeBtn active={mode === 'url'} onClick={() => setMode('url')}>
            URL
          </ModeBtn>
        </div>

        <div>
          <label className="label">Título *</label>
          <input
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ej: Manual de marca NINA 2026"
            autoFocus
          />
        </div>

        {mode === 'text' ? (
          <>
            <div>
              <label className="label">Contenido *</label>
              <textarea
                className="input min-h-[180px] resize-y leading-relaxed"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Pega aquí el texto, notas, lineamientos, decisiones…"
              />
            </div>
            <div>
              <label className="label">Tipo</label>
              <Select
                className="w-full"
                value={sourceKind}
                onChange={(v) => setSourceKind(v)}
                options={KIND_OPTIONS.filter((o) => o.value !== 'web')}
              />
            </div>
          </>
        ) : (
          <div>
            <label className="label">URL *</label>
            <input
              className="input"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
              type="url"
            />
            <p className="text-[11px] text-nina-mute mt-1">
              El cerebro descarga la página, la limpia y la ingesta.
            </p>
          </div>
        )}

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-4 border-t border-nina-line">
          <button type="button" onClick={close} className="btn-ghost" disabled={busy}>
            Cancelar
          </button>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Procesando…
              </>
            ) : (
              <>
                <Plus className="w-4 h-4" /> Subir al cerebro
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function ModeBtn({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 h-9 text-sm transition ${
        active ? 'bg-nina-line/60 text-nina-chrome' : 'text-nina-mute hover:text-nina-chrome hover:bg-nina-line/30'
      }`}
    >
      {children}
    </button>
  )
}
