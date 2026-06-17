// Tablero de tareas — rediseñado al estilo Mission Control de NeuralOS.
// ──────────────────────────────────────────────────────────────────────
// Patrones tomados: toolbar (search + filter + view toggle + new),
// columnas con icono + count + empty-state, cards con prioridad chip +
// agente avatar + tags + timestamps, vista lista alterna estilo Notion,
// drawer izquierdo con detalle + acciones.
// ──────────────────────────────────────────────────────────────────────
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import {
  Activity,
  AlertTriangle,
  Bot,
  Calculator,
  CheckCircle2,
  ChevronDown,
  Circle,
  Clock,
  Coins,
  Crown,
  ExternalLink,
  FileText,
  Hammer,
  LayoutGrid,
  List as ListIcon,
  ListTodo,
  Loader2,
  MessageSquare,
  Package,
  Play,
  Plus,
  Search,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  TrendingUp,
  X,
  Zap,
} from 'lucide-react'
import toast from 'react-hot-toast'
import EmptyState from '../../components/EmptyState'
import Modal from '../../components/Modal'
import { useAuth } from '../../context/AuthContext'
import { useConfirm } from '../../components/ConfirmDialog'
import { supabase } from '../../lib/supabase'
import { useTaskActivity } from '../../hooks/useTaskActivity'

// ─────────────────────────────────────────────────────────────────────
// Constantes
// ─────────────────────────────────────────────────────────────────────
const STATUS_COLUMNS = [
  {
    key: 'to_do',
    label: 'Por hacer',
    icon: Circle,
    accent: 'text-slate-300',
    accentBg: 'bg-slate-500/15',
    accentBorder: 'border-slate-500/30',
    accentBar: 'bg-slate-400',
  },
  {
    key: 'in_progress',
    label: 'En progreso',
    icon: Zap,
    accent: 'text-amber-300',
    accentBg: 'bg-amber-500/10',
    accentBorder: 'border-amber-500/30',
    accentBar: 'bg-amber-400',
  },
  {
    key: 'blocked',
    label: 'Bloqueadas',
    icon: ShieldAlert,
    accent: 'text-red-300',
    accentBg: 'bg-red-500/10',
    accentBorder: 'border-red-500/30',
    accentBar: 'bg-red-400',
  },
  {
    key: 'needs_review',
    label: 'Para revisar',
    icon: ShieldCheck,
    accent: 'text-purple-300',
    accentBg: 'bg-purple-500/10',
    accentBorder: 'border-purple-500/30',
    accentBar: 'bg-purple-400',
  },
  {
    key: 'done',
    label: 'Hechas',
    icon: CheckCircle2,
    accent: 'text-emerald-300',
    accentBg: 'bg-emerald-500/10',
    accentBorder: 'border-emerald-500/30',
    accentBar: 'bg-emerald-400',
  },
]

const PRIORITY = {
  1: { label: 'Crítica', color: 'text-red-300', bg: 'bg-red-500/15', border: 'border-red-500/30', icon: AlertTriangle, num: 1 },
  2: { label: 'Alta', color: 'text-amber-300', bg: 'bg-amber-500/15', border: 'border-amber-500/30', icon: AlertTriangle, num: 2 },
  3: { label: 'Normal', color: 'text-nina-chrome', bg: 'bg-nina-line/40', border: 'border-nina-line', icon: Circle, num: 3 },
  4: { label: 'Baja', color: 'text-nina-mute', bg: 'bg-nina-line/20', border: 'border-nina-line/60', icon: Circle, num: 4 },
  5: { label: 'Eventual', color: 'text-nina-mute', bg: 'bg-nina-line/10', border: 'border-nina-line/30', icon: Circle, num: 5 },
}

const STATUS_INFO = STATUS_COLUMNS.reduce((acc, c) => {
  acc[c.key] = c
  return acc
}, {})

const SPECIALTY_ICON = {
  analista_tendencias: TrendingUp,
  creador_contenido: Sparkles,
  contador: Calculator,
  inventarista: Package,
}

function agentIcon(agent) {
  if (!agent) return Bot
  if (agent.role === 'ceo_global') return Crown
  if (agent.role === 'brand_manager') return Sparkles
  return SPECIALTY_ICON[agent.specialty] ?? Bot
}

function fmtRelative(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const diff = Date.now() - d.getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'Ahora'
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h`
  const days = Math.floor(h / 24)
  if (days < 7) return `${days}d`
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })
}

function fmtFull(ts) {
  if (!ts) return ''
  return new Date(ts).toLocaleString('es-CO', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// ─────────────────────────────────────────────────────────────────────
// Componente principal
// ─────────────────────────────────────────────────────────────────────
export default function Tasks() {
  return <TasksBoard />
}

// Tablero reutilizable. Si `agentId` se pasa, filtra a las tareas de ese
// agente y oculta el header de página + el filtro por agente. `embedded`
// ajusta el padding para vivir dentro del workspace del agente.
export function TasksBoard({ agentId = null, embedded = false }) {
  const [tasks, setTasks] = useState([])
  const [agents, setAgents] = useState([])
  const [brands, setBrands] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [view, setView] = useState('kanban')
  const [filters, setFilters] = useState({
    priority: new Set(),
    agent: new Set(),
    status: new Set(),
  })
  const [selectedTaskId, setSelectedTaskId] = useState(null)
  const [newTaskOpen, setNewTaskOpen] = useState(false)
  const channelId = useId()

  useEffect(() => {
    let active = true
    const load = async () => {
      const [{ data: t, error: te }, { data: a }, { data: b }] = await Promise.all([
        supabase
          .from('tasks')
          .select(
            'id, title, description, status, priority, agent_id, brand_id, parent_task_id, due_at, created_at, updated_at, result, context',
          )
          .order('priority', { ascending: true })
          .order('created_at', { ascending: false })
          .limit(500),
        supabase.from('agents').select('id, name, slug, role, specialty, brand_id'),
        supabase.from('brands').select('id, name, slug'),
      ])
      if (!active) return
      if (te) console.error('[CRM-AI] tasks error:', te)
      // Si el board está acotado a un agente, filtramos a sus tareas.
      setTasks((t ?? []).filter((x) => !agentId || x.agent_id === agentId))
      setAgents(a ?? [])
      setBrands(b ?? [])
      setLoading(false)
    }
    load()

    const channel = supabase
      .channel(`tasks-all-${channelId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, load)
      .subscribe()

    return () => {
      active = false
      try {
        supabase.removeChannel(channel)
      } catch {}
    }
  }, [channelId, agentId])

  const agentsById = useMemo(() => {
    const map = {}
    for (const a of agents) map[a.id] = a
    return map
  }, [agents])

  const brandsById = useMemo(() => {
    const map = {}
    for (const b of brands) map[b.id] = b
    return map
  }, [brands])

  const tasksById = useMemo(() => {
    const map = {}
    for (const t of tasks) map[t.id] = t
    return map
  }, [tasks])

  const filtered = useMemo(() => {
    let result = tasks
    if (search) {
      const q = search.toLowerCase()
      result = result.filter(
        (t) =>
          t.title?.toLowerCase().includes(q) ||
          t.description?.toLowerCase().includes(q) ||
          agentsById[t.agent_id]?.name?.toLowerCase().includes(q),
      )
    }
    if (filters.priority.size > 0)
      result = result.filter((t) => filters.priority.has(t.priority))
    if (filters.agent.size > 0) result = result.filter((t) => filters.agent.has(t.agent_id))
    if (filters.status.size > 0) result = result.filter((t) => filters.status.has(t.status))
    return result
  }, [tasks, search, filters, agentsById])

  const grouped = useMemo(() => {
    const out = Object.fromEntries(STATUS_COLUMNS.map((c) => [c.key, []]))
    for (const t of filtered) {
      if (out[t.status]) out[t.status].push(t)
    }
    return out
  }, [filtered])

  const activeFilterCount = filters.priority.size + filters.agent.size + filters.status.size

  const removeFilter = (kind, value) => {
    setFilters((prev) => {
      const next = { ...prev, [kind]: new Set(prev[kind]) }
      next[kind].delete(value)
      return next
    })
  }

  const clearAllFilters = () => {
    setFilters({ priority: new Set(), agent: new Set(), status: new Set() })
  }

  const selectedTask = selectedTaskId ? tasksById[selectedTaskId] : null

  if (loading) {
    return (
      <div className="grid place-items-center py-20 text-nina-mute">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    )
  }

  if (tasks.length === 0) {
    return (
      <div className={embedded ? 'px-4 sm:px-6 pt-6' : 'lg:px-6 lg:pt-4'}>
        <EmptyState
          icon={ListTodo}
          title="Aún no hay tareas"
          description={
            agentId
              ? 'Este agente todavía no tiene tareas. Crea la primera.'
              : 'Crea la primera tarea para que un agente arranque a trabajar.'
          }
          actions={
            <button
              onClick={() => setNewTaskOpen(true)}
              className="btn-primary text-sm"
            >
              <Plus className="w-4 h-4" />
              Nueva tarea
            </button>
          }
        />
        <NewTaskModal
          open={newTaskOpen}
          onClose={() => setNewTaskOpen(false)}
          agents={agents}
          brands={brands}
          defaultAgentId={agentId}
        />
      </div>
    )
  }

  return (
    <div
      className={`flex flex-col h-full min-h-0 ${
        embedded ? 'px-4 sm:px-6 pt-4' : 'lg:px-6 lg:pt-4'
      }`}
    >
      <TasksToolbar
        search={search}
        onSearchChange={setSearch}
        view={view}
        onViewChange={setView}
        filters={filters}
        onFiltersChange={setFilters}
        activeFilterCount={activeFilterCount}
        agents={agents}
        onNewTask={() => setNewTaskOpen(true)}
        totalCount={filtered.length}
        ofCount={tasks.length}
        embedded={embedded}
        hideAgentFilter={Boolean(agentId)}
      />

      {activeFilterCount > 0 && (
        <FilterChipsRow
          filters={filters}
          agentsById={agentsById}
          onRemove={removeFilter}
          onClearAll={clearAllFilters}
        />
      )}

      <div className="flex-1 min-h-0 mt-4">
        {view === 'kanban' ? (
          <KanbanView
            grouped={grouped}
            agentsById={agentsById}
            brandsById={brandsById}
            onSelectTask={setSelectedTaskId}
          />
        ) : (
          <ListView
            grouped={grouped}
            agentsById={agentsById}
            brandsById={brandsById}
            onSelectTask={setSelectedTaskId}
          />
        )}
      </div>

      <TaskDrawer
        task={selectedTask}
        agentsById={agentsById}
        brandsById={brandsById}
        tasksById={tasksById}
        onClose={() => setSelectedTaskId(null)}
      />

      <NewTaskModal
        open={newTaskOpen}
        onClose={() => setNewTaskOpen(false)}
        agents={agents}
        brands={brands}
        defaultAgentId={agentId}
      />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Toolbar — search + filter dropdown + view toggle + new task
// ─────────────────────────────────────────────────────────────────────
function TasksToolbar({
  search,
  onSearchChange,
  view,
  onViewChange,
  filters,
  onFiltersChange,
  activeFilterCount,
  agents,
  onNewTask,
  totalCount,
  ofCount,
  embedded = false,
  hideAgentFilter = false,
}) {
  const [filterOpen, setFilterOpen] = useState(false)
  const filtered = totalCount !== ofCount

  return (
    <header className="space-y-3">
      {!embedded && (
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-display text-2xl silver-text mb-1">Tablero de tareas</h2>
            <p className="text-sm text-nina-mute">
              Vista global del trabajo de todos los agentes.
              {filtered && (
                <span className="ml-2 text-nina-chrome">
                  {totalCount}/{ofCount} mostradas
                </span>
              )}
            </p>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        {/* Search — capado a la izquierda; un spacer empuja los controles a la derecha */}
        <div className="min-w-[200px] w-full sm:w-80 flex items-center gap-2 px-3 h-9 rounded-xl bg-nina-line/20 border border-nina-line focus-within:border-nina-silver/40 transition-colors">
          <Search className="w-3.5 h-3.5 text-nina-mute shrink-0" />
          <input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Buscar tareas, agentes, descripción…"
            className="flex-1 bg-transparent outline-none text-xs text-nina-chrome placeholder:text-nina-mute"
          />
          {search && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              className="text-nina-mute hover:text-nina-chrome"
              aria-label="Limpiar búsqueda"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Spacer: empuja filtro / vista / nueva tarea al borde derecho */}
        <div className="hidden sm:block flex-1" />

        {/* Filter button + dropdown */}
        <FilterButton
          open={filterOpen}
          onOpenChange={setFilterOpen}
          filters={filters}
          onFiltersChange={onFiltersChange}
          agents={agents}
          activeCount={activeFilterCount}
          hideAgentFilter={hideAgentFilter}
        />

        {/* View toggle */}
        <div className="flex items-center bg-nina-line/20 border border-nina-line rounded-xl p-0.5">
          <button
            type="button"
            onClick={() => onViewChange('kanban')}
            className={`w-8 h-8 grid place-items-center rounded-lg transition ${
              view === 'kanban'
                ? 'bg-nina-silver/15 text-nina-chrome'
                : 'text-nina-mute hover:text-nina-chrome'
            }`}
            title="Vista Kanban"
            aria-label="Vista Kanban"
          >
            <LayoutGrid className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onViewChange('list')}
            className={`w-8 h-8 grid place-items-center rounded-lg transition ${
              view === 'list'
                ? 'bg-nina-silver/15 text-nina-chrome'
                : 'text-nina-mute hover:text-nina-chrome'
            }`}
            title="Vista lista"
            aria-label="Vista lista"
          >
            <ListIcon className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* New task button */}
        <button
          onClick={onNewTask}
          className="btn-primary !h-9 !py-0 !px-3 text-xs"
        >
          <Plus className="w-3.5 h-3.5" />
          Nueva tarea
        </button>
      </div>
    </header>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Botón de filtros + dropdown panel
// ─────────────────────────────────────────────────────────────────────
function FilterButton({ open, onOpenChange, filters, onFiltersChange, agents, activeCount, hideAgentFilter = false }) {
  const panelRef = useRef(null)
  const btnRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target) &&
        btnRef.current &&
        !btnRef.current.contains(e.target)
      ) {
        onOpenChange(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open, onOpenChange])

  const toggle = (kind, value) => {
    onFiltersChange((prev) => {
      const next = { ...prev, [kind]: new Set(prev[kind]) }
      if (next[kind].has(value)) next[kind].delete(value)
      else next[kind].add(value)
      return next
    })
  }

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        onClick={() => onOpenChange(!open)}
        className={`relative h-9 w-9 grid place-items-center rounded-xl border transition ${
          open || activeCount > 0
            ? 'bg-nina-silver/15 border-nina-silver/40 text-nina-chrome'
            : 'bg-nina-line/20 border-nina-line text-nina-mute hover:text-nina-chrome'
        }`}
        title="Filtros"
        aria-label="Filtros"
        aria-pressed={open}
      >
        <SlidersHorizontal className="w-3.5 h-3.5" />
        {activeCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-nina-silver text-nina-black text-[9px] font-bold leading-[16px] text-center">
            {activeCount}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            ref={panelRef}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            className="absolute right-0 top-full mt-2 z-30 w-72 rounded-xl border border-nina-line bg-nina-panel shadow-xl p-3 space-y-3"
          >
            <FilterSection title="Prioridad">
              <div className="flex flex-wrap gap-1.5">
                {[1, 2, 3, 4, 5].map((p) => (
                  <FilterPill
                    key={p}
                    active={filters.priority.has(p)}
                    onClick={() => toggle('priority', p)}
                  >
                    {PRIORITY[p].label}
                  </FilterPill>
                ))}
              </div>
            </FilterSection>

            <FilterSection title="Estado">
              <div className="flex flex-wrap gap-1.5">
                {STATUS_COLUMNS.map((s) => (
                  <FilterPill
                    key={s.key}
                    active={filters.status.has(s.key)}
                    onClick={() => toggle('status', s.key)}
                  >
                    {s.label}
                  </FilterPill>
                ))}
              </div>
            </FilterSection>

            {!hideAgentFilter && (
              <FilterSection title="Agente">
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {agents.map((a) => {
                    const Icon = agentIcon(a)
                    const isActive = filters.agent.has(a.id)
                    return (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => toggle('agent', a.id)}
                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition ${
                          isActive
                            ? 'bg-nina-silver/15 text-nina-chrome'
                            : 'text-nina-mute hover:bg-nina-line/30 hover:text-nina-chrome'
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5 shrink-0" />
                        <span className="text-xs truncate flex-1">{a.name}</span>
                        {isActive && <CheckCircle2 className="w-3 h-3 text-emerald-400" />}
                      </button>
                    )
                  })}
                </div>
              </FilterSection>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function FilterSection({ title, children }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.18em] text-nina-mute mb-1.5">{title}</div>
      {children}
    </div>
  )
}

function FilterPill({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 py-1 rounded-full text-[11px] border transition ${
        active
          ? 'bg-nina-silver/20 border-nina-silver/40 text-nina-chrome'
          : 'bg-nina-line/20 border-nina-line text-nina-mute hover:text-nina-chrome'
      }`}
    >
      {children}
    </button>
  )
}

function FilterChipsRow({ filters, agentsById, onRemove, onClearAll }) {
  const chips = []
  filters.priority.forEach((p) =>
    chips.push({
      kind: 'priority',
      value: p,
      label: PRIORITY[p]?.label || p,
    }),
  )
  filters.status.forEach((s) =>
    chips.push({
      kind: 'status',
      value: s,
      label: STATUS_INFO[s]?.label || s,
    }),
  )
  filters.agent.forEach((a) =>
    chips.push({
      kind: 'agent',
      value: a,
      label: agentsById[a]?.name || a,
    }),
  )

  return (
    <div className="mt-2 flex items-center gap-2 flex-wrap">
      {chips.map((c) => (
        <span
          key={`${c.kind}-${c.value}`}
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-nina-line/30 border border-nina-line text-[11px] text-nina-chrome"
        >
          <span className="text-[9px] uppercase tracking-[0.15em] text-nina-mute">
            {c.kind === 'priority' ? 'Prio' : c.kind === 'status' ? 'Estado' : 'Agente'}
          </span>
          <span>{c.label}</span>
          <button
            type="button"
            onClick={() => onRemove(c.kind, c.value)}
            className="text-nina-mute hover:text-red-300"
            aria-label="Quitar filtro"
          >
            <X className="w-2.5 h-2.5" />
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={onClearAll}
        className="text-[11px] text-nina-mute hover:text-nina-chrome underline underline-offset-2"
      >
        Limpiar todo
      </button>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Vista Kanban
// ─────────────────────────────────────────────────────────────────────
function KanbanView({ grouped, agentsById, brandsById, onSelectTask }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3 h-full">
      {STATUS_COLUMNS.map((col) => {
        const ColIcon = col.icon
        const items = grouped[col.key] ?? []
        return (
          <div
            key={col.key}
            className="rounded-2xl border border-nina-line bg-nina-panel/40 flex flex-col min-h-[200px]"
          >
            <div className="px-3 py-2.5 border-b border-nina-line flex items-center justify-between">
              <div className={`flex items-center gap-1.5 ${col.accent}`}>
                <ColIcon className="w-3.5 h-3.5" />
                <span className="text-[11px] font-medium uppercase tracking-[0.12em]">
                  {col.label}
                </span>
              </div>
              <span
                className={`text-[10px] font-bold min-w-[18px] h-[18px] px-1.5 rounded-full grid place-items-center ${col.accentBg} ${col.accent} border ${col.accentBorder}`}
              >
                {items.length}
              </span>
            </div>
            <div className="flex-1 overflow-y-auto px-2 py-2 space-y-2">
              {items.length === 0 ? (
                <div className="grid place-items-center h-full text-nina-mute py-8">
                  <div className="flex flex-col items-center gap-2 opacity-50">
                    <ColIcon className="w-6 h-6" />
                    <span className="text-[10px] uppercase tracking-[0.18em]">
                      Sin tareas
                    </span>
                  </div>
                </div>
              ) : (
                items.map((t) => (
                  <TaskCard
                    key={t.id}
                    task={t}
                    agent={agentsById[t.agent_id]}
                    brand={brandsById[t.brand_id]}
                    onSelect={() => onSelectTask(t.id)}
                  />
                ))
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// TaskCard — card rica en la vista kanban
// ─────────────────────────────────────────────────────────────────────
function TaskCard({ task, agent, brand, onSelect }) {
  const prio = PRIORITY[task.priority] ?? PRIORITY[3]
  const PrioIcon = prio.icon
  const status = STATUS_INFO[task.status]
  const AgentIcon = agentIcon(agent)
  const isDone = task.status === 'done'
  const summary = task.result?.summary
  const isCritical = task.priority <= 2

  return (
    <motion.button
      type="button"
      onClick={onSelect}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -1 }}
      transition={{ duration: 0.15 }}
      className={`relative w-full text-left rounded-xl border bg-nina-ink hover:bg-nina-ink/80 p-2.5 space-y-2 transition group ${
        isCritical ? prio.border : 'border-nina-line hover:border-nina-silver/40'
      }`}
    >
      {/* Top accent bar — color de status */}
      <div
        className={`absolute -top-px -left-px -right-px h-0.5 rounded-t-xl ${status?.accentBar ?? 'bg-nina-line'}`}
      />

      {/* Top row: prioridad + brand */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[9px] font-bold uppercase tracking-[0.08em] ${prio.bg} ${prio.color} ${prio.border}`}
        >
          {isCritical && <PrioIcon className="w-2.5 h-2.5" />}
          {prio.label}
        </span>
        {brand && (
          <span className="text-[9px] uppercase tracking-[0.15em] text-nina-mute truncate">
            · {brand.name}
          </span>
        )}
        <span className="ml-auto text-[9px] text-nina-mute">{fmtRelative(task.created_at)}</span>
      </div>

      {/* Title */}
      <div className="text-[12.5px] text-nina-chrome leading-snug line-clamp-2 font-medium">
        {task.title}
      </div>

      {/* Description preview */}
      {task.description && (
        <div className="text-[10.5px] text-nina-mute leading-snug line-clamp-2">
          {task.description}
        </div>
      )}

      {/* Done result preview */}
      {isDone && summary && (
        <div className="text-[10.5px] text-emerald-300/80 leading-snug line-clamp-2 border-l-2 border-emerald-500/30 pl-2">
          → {summary}
        </div>
      )}

      {/* Bottom: agente */}
      {agent && (
        <div className="flex items-center gap-1.5 pt-0.5">
          <div className="w-5 h-5 rounded-md grid place-items-center bg-silver-gradient text-nina-black shrink-0">
            <AgentIcon className="w-3 h-3" />
          </div>
          <span className="text-[10.5px] text-nina-mute truncate">{agent.name}</span>
        </div>
      )}
    </motion.button>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Vista Lista — estilo Notion/Linear
// ─────────────────────────────────────────────────────────────────────
function ListView({ grouped, agentsById, brandsById, onSelectTask }) {
  return (
    <div className="rounded-2xl border border-nina-line bg-nina-panel/40 overflow-hidden">
      <div className="overflow-y-auto max-h-[calc(100vh-220px)]">
        {STATUS_COLUMNS.map((col) => {
          const items = grouped[col.key] ?? []
          if (items.length === 0) return null
          const ColIcon = col.icon
          return (
            <div key={col.key}>
              <div
                className={`sticky top-0 z-10 px-4 py-2 bg-nina-panel/95 backdrop-blur-sm border-b border-nina-line flex items-center gap-2 ${col.accent}`}
              >
                <ColIcon className="w-3.5 h-3.5" />
                <span className="text-[11px] font-medium uppercase tracking-[0.12em]">
                  {col.label}
                </span>
                <span className="text-[10px] text-nina-mute">· {items.length}</span>
              </div>
              <div className="divide-y divide-nina-line/40">
                {items.map((t) => (
                  <ListRow
                    key={t.id}
                    task={t}
                    agent={agentsById[t.agent_id]}
                    brand={brandsById[t.brand_id]}
                    onSelect={() => onSelectTask(t.id)}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ListRow({ task, agent, brand, onSelect }) {
  const prio = PRIORITY[task.priority] ?? PRIORITY[3]
  const AgentIcon = agentIcon(agent)
  return (
    <button
      type="button"
      onClick={onSelect}
      className="w-full px-4 py-2.5 flex items-center gap-3 hover:bg-nina-line/20 transition text-left group"
    >
      <span
        className={`shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-[0.08em] ${prio.bg} ${prio.color} border ${prio.border}`}
      >
        {prio.label}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] text-nina-chrome leading-snug truncate">{task.title}</div>
        {task.description && (
          <div className="text-[11px] text-nina-mute truncate">{task.description}</div>
        )}
      </div>
      {brand && (
        <span className="hidden md:inline text-[10px] text-nina-mute truncate max-w-[100px]">
          {brand.name}
        </span>
      )}
      {agent && (
        <div className="hidden sm:flex items-center gap-1.5 shrink-0">
          <div className="w-5 h-5 rounded-md grid place-items-center bg-silver-gradient text-nina-black shrink-0">
            <AgentIcon className="w-3 h-3" />
          </div>
          <span className="text-[11px] text-nina-mute truncate max-w-[100px]">{agent.name}</span>
        </div>
      )}
      <span className="text-[10px] text-nina-mute shrink-0 min-w-[40px] text-right">
        {fmtRelative(task.created_at)}
      </span>
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Drawer del detalle de tarea — Fase A estilo NeuralOS (pestañas + actividad)
// ─────────────────────────────────────────────────────────────────────
const STATUS_PROGRESS = { to_do: 5, in_progress: 50, blocked: 40, needs_review: 85, done: 100 }
const COST_PER_MILLION_USD = 0.6 // estimación blended sólo para mostrar ~$; el dato real son los tokens

// Parte la descripción (formato de delegate_task) en secciones Objetivo/Contexto/Criterio.
function parseTaskBrief(description) {
  const raw = (description || '').trim()
  if (!raw) return { sections: [], raw: '' }
  const labels = [
    { key: 'Objetivo', re: /Objetivo\s*:/i },
    { key: 'Contexto', re: /Contexto\s*:/i },
    { key: 'Criterio de éxito', re: /Criterio de [eé]xito\s*:/i },
  ]
  const found = []
  for (const l of labels) {
    const m = raw.match(l.re)
    if (m) found.push({ key: l.key, contentStart: m.index + m[0].length, start: m.index })
  }
  if (found.length === 0) return { sections: [], raw }
  found.sort((a, b) => a.start - b.start)
  const sections = found
    .map((f, i) => ({
      key: f.key,
      value: raw.slice(f.contentStart, i + 1 < found.length ? found[i + 1].start : raw.length).trim(),
    }))
    .filter((s) => s.value)
  return { sections, raw: '' }
}

function sumTokens(messages) {
  let t = 0
  for (const m of messages) {
    const v = m?.metadata?.usage?.total_tokens
    if (v != null) t += Number(v) || 0
  }
  return t
}

function fmtDuration(ms) {
  if (!ms || ms < 0) return '—'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}min`
  return `${(m / 60).toFixed(1)}h`
}

const truncate = (s, n = 280) => {
  const str = String(s || '').trim()
  return str.length > n ? str.slice(0, n) + '…' : str
}

// Eventos del timeline a partir de los mensajes de la tarea (+ estado final).
function buildTimeline(messages, task, agentName) {
  const ev = [
    { kind: 'created', title: 'Tarea creada', detail: agentName ? `Asignada a ${agentName}` : null, at: task.created_at },
  ]
  for (const m of messages) {
    if (m.role === 'user') {
      // La inyección autónoma de la tarea ("[Tarea <id>] …") ya está representada por
      // "Tarea creada" + el bloque Details; no la repetimos como evento.
      if (/^\[Tarea\s/i.test(String(m.content || ''))) continue
      ev.push({ kind: 'instruction', title: 'Instrucción', detail: truncate(m.content), at: m.created_at })
    } else if (m.role === 'assistant') {
      if (m.content && String(m.content).trim()) {
        ev.push({ kind: 'reasoning', title: 'Razonamiento', detail: truncate(m.content), at: m.created_at })
      }
      const calls = Array.isArray(m.tool_calls) ? m.tool_calls : []
      for (const c of calls) {
        ev.push({ kind: 'tool', title: 'Herramienta', detail: c?.function?.name || c?.name || 'herramienta', at: m.created_at })
      }
    } else if (m.role === 'tool') {
      let ok = true
      try { ok = JSON.parse(m.content)?.ok !== false } catch { /* contenido no-JSON */ }
      ev.push({ kind: 'result', title: 'Resultado', detail: ok ? 'ok' : 'error', at: m.created_at, ok })
    }
  }
  if (task.status === 'done') {
    ev.push({ kind: 'done', title: 'Completada', detail: truncate(task.result?.summary), at: task.updated_at })
  } else if (task.status === 'blocked') {
    ev.push({ kind: 'blocked', title: 'Bloqueada', detail: 'Esperando aprobación o subordinados', at: task.updated_at })
  }
  return ev
}

function MetaRow({ icon: Icon, label, children }) {
  return (
    <div className="flex items-start gap-2 min-w-0">
      <Icon className="w-3.5 h-3.5 text-nina-mute mt-0.5 shrink-0" />
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-[0.14em] text-nina-mute">{label}</div>
        <div className="text-sm text-nina-chrome truncate">{children}</div>
      </div>
    </div>
  )
}

const TL_STYLE = {
  created: { dot: 'bg-nina-silver', Icon: Sparkles, label: 'text-nina-chrome' },
  instruction: { dot: 'bg-sky-400', Icon: MessageSquare, label: 'text-sky-300' },
  reasoning: { dot: 'bg-violet-400', Icon: Sparkles, label: 'text-violet-300' },
  tool: { dot: 'bg-amber-400', Icon: Hammer, label: 'text-amber-300' },
  result: { dot: 'bg-emerald-400', Icon: CheckCircle2, label: 'text-emerald-300' },
  done: { dot: 'bg-emerald-400', Icon: CheckCircle2, label: 'text-emerald-300' },
  blocked: { dot: 'bg-red-400', Icon: AlertTriangle, label: 'text-red-300' },
}

function ActivityTimeline({ events, live, loading }) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-nina-mute">
        <Loader2 className="w-4 h-4 animate-spin" /> Cargando actividad…
      </div>
    )
  }
  if (events.length === 0) {
    return <p className="text-sm text-nina-mute">Aún no hay actividad registrada para esta tarea.</p>
  }
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <span className="text-[11px] uppercase tracking-[0.16em] text-nina-mute">{events.length} eventos</span>
        {live && (
          <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-red-300">
            <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" /> En vivo
          </span>
        )}
      </div>
      <ol className="relative space-y-4 before:absolute before:left-[5px] before:top-2 before:bottom-2 before:w-px before:bg-nina-line/70">
        {events.map((e, i) => {
          const st = TL_STYLE[e.kind] ?? TL_STYLE.reasoning
          const Icon = st.Icon
          return (
            <li key={i} className="relative pl-6">
              <span className={`absolute left-0 top-1.5 w-2.5 h-2.5 rounded-full ${st.dot} ring-4 ring-nina-panel`} />
              <div className="flex items-center gap-2">
                <Icon className={`w-3 h-3 ${st.label} shrink-0`} />
                <span className={`text-[10px] uppercase tracking-[0.14em] ${st.label}`}>{e.title}</span>
                {e.kind === 'tool' && e.detail && (
                  <span className="text-[11px] text-nina-mute truncate">· {e.detail}</span>
                )}
                <span className="ml-auto text-[10px] text-nina-mute shrink-0">{fmtRelative(e.at)}</span>
              </div>
              {e.detail && e.kind !== 'tool' && e.kind !== 'created' && (
                <p className="text-sm text-nina-chrome/90 leading-relaxed mt-1 whitespace-pre-wrap">{e.detail}</p>
              )}
              {e.kind === 'created' && e.detail && <p className="text-[11px] text-nina-mute mt-0.5">{e.detail}</p>}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function TaskDrawer({ task, agentsById, brandsById, tasksById, onClose }) {
  const { isJunta } = useAuth()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const [updating, setUpdating] = useState(false)
  const [tab, setTab] = useState('details')

  // Mensajes de la tarea, en vivo (timeline de Activity + tokens). Devuelve [] si task es null.
  const { messages, loading: activityLoading } = useTaskActivity(task?.id)

  const brief = useMemo(() => parseTaskBrief(task?.description), [task?.description])
  const tokens = useMemo(() => sumTokens(messages), [messages])
  const events = useMemo(
    () => (task ? buildTimeline(messages, task, agentsById[task.agent_id]?.name) : []),
    [messages, task, agentsById],
  )

  // Close on Escape
  useEffect(() => {
    if (!task) return
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [task, onClose])

  if (!task) return null
  const agent = agentsById[task.agent_id]
  const brand = brandsById[task.brand_id]
  const parent = task.parent_task_id ? tasksById[task.parent_task_id] : null
  const status = STATUS_INFO[task.status]
  const prio = PRIORITY[task.priority] ?? PRIORITY[3]
  const StatusIcon = status?.icon ?? Circle
  const AgentIcon = agentIcon(agent)

  const progress = STATUS_PROGRESS[task.status] ?? 0
  const elapsedMs =
    (task.status === 'done' ? new Date(task.updated_at).getTime() : Date.now()) -
    new Date(task.created_at).getTime()
  const costEst = tokens > 0 ? (tokens / 1_000_000) * COST_PER_MILLION_USD : 0
  const live = task.status === 'in_progress'

  const changeStatus = async (newStatus) => {
    if (updating || newStatus === task.status) return
    setUpdating(true)
    const t = toast.loading('Actualizando estado…')
    try {
      const { error } = await supabase.from('tasks').update({ status: newStatus }).eq('id', task.id)
      if (error) throw error
      toast.success('Estado actualizado', { id: t })
    } catch (e) {
      toast.error(e?.message || 'No se pudo actualizar', { id: t })
    } finally {
      setUpdating(false)
    }
  }

  const handleDelete = async () => {
    const ok = await confirm({
      title: '¿Eliminar esta tarea?',
      description:
        'Se borra junto con sus mensajes y tool calls asociados. No se puede deshacer.',
      confirmText: 'Eliminar',
      variant: 'danger',
    })
    if (!ok) return
    const t = toast.loading('Eliminando…')
    const { error } = await supabase.from('tasks').delete().eq('id', task.id)
    if (error) {
      toast.error(error.message || 'No se pudo eliminar', { id: t })
      return
    }
    toast.success('Tarea eliminada', { id: t })
    onClose()
  }

  const openInAgentChat = () => {
    if (!agent) return
    navigate(`/admin/agentes/${agent.slug}`)
    onClose()
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.aside
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', stiffness: 320, damping: 32 }}
        className="fixed inset-y-0 right-0 z-50 w-full sm:w-[460px] flex flex-col bg-nina-panel border-l border-nina-line shadow-2xl"
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-nina-line flex items-center gap-2 shrink-0">
          <button
            onClick={onClose}
            className="btn-ghost !p-2"
            aria-label="Cerrar"
            title="Cerrar (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
          <span
            className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-medium uppercase tracking-[0.12em] ${status?.accentBg} ${status?.accent} border ${status?.accentBorder}`}
          >
            <StatusIcon className="w-3 h-3" />
            {status?.label ?? task.status}
          </span>
          <span
            className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-[0.08em] ${prio.bg} ${prio.color} border ${prio.border}`}
          >
            {prio.label}
          </span>
          <div className="ml-auto" />
          {isJunta && (
            <button
              onClick={handleDelete}
              className="btn-ghost !p-2 text-red-300 hover:text-red-200"
              title="Eliminar tarea"
              aria-label="Eliminar tarea"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto flex flex-col">
          {/* Título + progreso + meta */}
          <div className="px-5 pt-5 pb-4 space-y-4 border-b border-nina-line">
            <h3 className="text-lg text-nina-chrome leading-snug">{task.title}</h3>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] uppercase tracking-[0.18em] text-nina-mute">Progreso</span>
                <span className="text-xs text-nina-chrome">{progress}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-nina-line/40 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${progress === 100 ? 'bg-emerald-400' : 'bg-nina-silver'}`}
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              <MetaRow icon={Bot} label="Responsable">
                {agent ? (
                  <button onClick={openInAgentChat} className="inline-flex items-center gap-1 hover:text-white">
                    {agent.name} <ExternalLink className="w-3 h-3 opacity-50" />
                  </button>
                ) : (
                  <span className="text-nina-mute">—</span>
                )}
              </MetaRow>
              <MetaRow icon={Clock} label="Fecha límite">
                {task.due_at ? fmtFull(task.due_at) : <span className="text-nina-mute">Sin fecha</span>}
              </MetaRow>
              {brand && <MetaRow icon={Package} label="Marca">{brand.name}</MetaRow>}
              {parent && <MetaRow icon={ListTodo} label="Tarea padre">{parent.title}</MetaRow>}
            </div>
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-1 px-5 pt-3 border-b border-nina-line shrink-0">
            {[
              { key: 'details', label: 'Details', Icon: FileText, count: 0 },
              { key: 'activity', label: 'Activity', Icon: Activity, count: events.length },
            ].map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`relative flex items-center gap-1.5 px-3 py-2 text-xs transition ${
                  tab === t.key ? 'text-nina-chrome' : 'text-nina-mute hover:text-nina-chrome'
                }`}
              >
                <t.Icon className="w-3.5 h-3.5" />
                {t.label}
                {t.count > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-nina-line/50 text-nina-mute">
                    {t.count}
                  </span>
                )}
                {tab === t.key && (
                  <span className="absolute left-3 right-3 -bottom-px h-0.5 rounded-full bg-nina-silver" />
                )}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="px-5 py-5">
            {tab === 'details' ? (
              <div className="space-y-5">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-3.5">
                    <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-amber-300/80 mb-1.5">
                      <Coins className="w-3 h-3" /> Costo &amp; Tokens
                    </div>
                    <div className="text-xl text-amber-200 font-display">≈ ${costEst.toFixed(2)}</div>
                    <div className="text-[11px] text-nina-mute mt-0.5">{tokens.toLocaleString('es-CO')} tokens</div>
                  </div>
                  <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] p-3.5">
                    <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-emerald-300/80 mb-1.5">
                      <Clock className="w-3 h-3" /> Tiempo
                    </div>
                    <div className="text-xl text-emerald-200 font-display">{fmtDuration(elapsedMs)}</div>
                    <div className="text-[11px] text-nina-mute mt-0.5">transcurrido</div>
                  </div>
                </div>

                <div className="rounded-xl border border-nina-line bg-nina-ink/40 p-4 space-y-4">
                  <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-nina-mute">
                    <FileText className="w-3.5 h-3.5" /> Detalles de la tarea
                  </div>
                  {brief.sections.length > 0 ? (
                    brief.sections.map((s) => (
                      <div key={s.key}>
                        <div className="text-sm text-nina-chrome font-semibold mb-1">{s.key}</div>
                        <p className="text-sm text-nina-mute leading-relaxed whitespace-pre-wrap">{s.value}</p>
                      </div>
                    ))
                  ) : brief.raw ? (
                    <p className="text-sm text-nina-mute leading-relaxed whitespace-pre-wrap">{brief.raw}</p>
                  ) : (
                    <p className="text-sm text-nina-mute">Sin descripción.</p>
                  )}
                </div>

                {task.result?.summary && (
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-emerald-300/80 mb-1.5">Resultado</div>
                    <p className="text-sm text-emerald-200 leading-relaxed whitespace-pre-wrap">{task.result.summary}</p>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4 pt-1">
                  <Field label="Creada">{fmtFull(task.created_at)}</Field>
                  <Field label="Actualizada">{fmtFull(task.updated_at)}</Field>
                </div>
              </div>
            ) : (
              <ActivityTimeline events={events} live={live} loading={activityLoading} />
            )}
          </div>
        </div>

        {/* Bottom actions: cambiar estado */}
        {isJunta && (
          <div className="px-4 py-3 border-t border-nina-line shrink-0">
            <div className="text-[10px] uppercase tracking-[0.2em] text-nina-mute mb-2">
              Mover a
            </div>
            <div className="flex flex-wrap gap-1.5">
              {STATUS_COLUMNS.filter((c) => c.key !== task.status).map((c) => {
                const SI = c.icon
                return (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => changeStatus(c.key)}
                    disabled={updating}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] border transition ${c.accentBg} ${c.accent} ${c.accentBorder} hover:opacity-80`}
                  >
                    <SI className="w-3 h-3" />
                    {c.label}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </motion.aside>
    </AnimatePresence>
  )
}

function Section({ title, children }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.2em] text-nina-mute mb-1.5">{title}</div>
      {children}
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.18em] text-nina-mute mb-1">{label}</div>
      <div className="text-[12px] text-nina-chrome font-mono">{children}</div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Modal · nueva tarea (con picker de agente y marca)
// ─────────────────────────────────────────────────────────────────────
function NewTaskModal({ open, onClose, agents, brands, defaultAgentId = null }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState(3)
  const [agentId, setAgentId] = useState('')
  const [brandId, setBrandId] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setTitle('')
    setDescription('')
    setPriority(3)
    setAgentId(defaultAgentId || agents[0]?.id || '')
    setBrandId('')
  }, [open, agents, defaultAgentId])

  const submit = async (e) => {
    e.preventDefault()
    if (!title.trim()) {
      toast.error('Pon al menos un título')
      return
    }
    if (!agentId) {
      toast.error('Selecciona un agente')
      return
    }
    setBusy(true)
    const agent = agents.find((a) => a.id === agentId)
    try {
      const { error } = await supabase.from('tasks').insert({
        brand_id: brandId || agent?.brand_id || null,
        agent_id: agentId,
        title: title.trim(),
        description: description.trim() || null,
        status: 'to_do',
        priority: Number(priority) || 3,
      })
      if (error) throw error
      toast.success(`Tarea creada para ${agent?.name ?? 'el agente'}`)
      onClose()
    } catch (err) {
      toast.error(err.message || 'No se pudo crear la tarea')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Nueva tarea">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label">Título</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="input"
            placeholder="Ej: Define la primera campaña Q3 de NINA"
            autoFocus
          />
        </div>
        <div>
          <label className="label">Descripción / contexto</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="input min-h-[110px] resize-y"
            placeholder="Explica el objetivo, datos relevantes, criterio de éxito, deadline..."
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Asignar a</label>
            <select
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              className="input"
            >
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Prioridad</label>
            <select
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value))}
              className="input"
            >
              <option value={1}>1 · Crítica</option>
              <option value={2}>2 · Alta</option>
              <option value={3}>3 · Normal</option>
              <option value={4}>4 · Baja</option>
              <option value={5}>5 · Eventual</option>
            </select>
          </div>
        </div>
        <div>
          <label className="label">Marca (opcional)</label>
          <select
            value={brandId}
            onChange={(e) => setBrandId(e.target.value)}
            className="input"
          >
            <option value="">— Usar la marca del agente —</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-ghost" disabled={busy}>
            Cancelar
          </button>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? 'Creando…' : 'Crear tarea'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
