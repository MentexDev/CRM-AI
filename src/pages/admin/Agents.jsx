import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  ArrowLeft,
  BookOpen,
  Bot,
  Calculator,
  ChevronRight,
  CircleDot,
  Crown,
  Hammer,
  ListTodo,
  Loader2,
  MessageSquare,
  Package,
  Pencil,
  Play,
  Plus,
  Settings as SettingsIcon,
  Sparkles,
  Thermometer,
  TrendingUp,
  UserPlus,
  Wrench,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useAgents } from '../../hooks/useAgents'
import { useAgentDetail } from '../../hooks/useAgentDetail'
import { useAgentMessages } from '../../hooks/useAgentMessages'
import { useAgentTasks } from '../../hooks/useAgentTasks'
import { useAuth } from '../../context/AuthContext'
import { useConfirm } from '../../components/ConfirmDialog'
import EmptyState from '../../components/EmptyState'
import Modal from '../../components/Modal'
import NewAgentModal from '../../components/NewAgentModal'
import AgentActionsMenu from '../../components/AgentActionsMenu'
import { supabase } from '../../lib/supabase'

const STATUS_DOT = {
  idle: 'bg-nina-mute',
  running: 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)] animate-pulse',
  blocked: 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.45)]',
  disabled: 'bg-red-400',
}
const STATUS_LABEL = {
  idle: 'En reposo',
  running: 'Trabajando',
  blocked: 'Bloqueado',
  disabled: 'Deshabilitado',
}

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

function fmtTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) return d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })
}

export default function Agents() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const { agents, loading } = useAgents()
  const { isJunta } = useAuth()
  const confirm = useConfirm()
  const activeAgent = useMemo(() => agents.find((a) => a.slug === slug), [agents, slug])
  const [taskOpen, setTaskOpen] = useState(false)
  const [agentModal, setAgentModal] = useState({ open: false, agentId: null })

  const closeAgentModal = () => setAgentModal({ open: false, agentId: null })

  const handleEdit = (agent) => setAgentModal({ open: true, agentId: agent.id })

  const handleTogglePause = async (agent) => {
    const next = agent.status === 'disabled' ? 'idle' : 'disabled'
    const { error } = await supabase.from('agents').update({ status: next }).eq('id', agent.id)
    if (error) {
      toast.error(error.message || 'No se pudo actualizar')
      return
    }
    toast.success(next === 'disabled' ? `${agent.name} en pausa` : `${agent.name} reactivado`)
  }

  const handleDelete = async (agent) => {
    const ok = await confirm({
      title: `¿Eliminar ${agent.name}?`,
      description:
        'Se borran su historial de mensajes, sus tool_calls y la memoria de largo plazo. Las tareas que tenía asignadas quedan sin agente. Esta acción no se puede deshacer.',
      confirmText: 'Eliminar',
      variant: 'danger',
    })
    if (!ok) return
    const { error } = await supabase.from('agents').delete().eq('id', agent.id)
    if (error) {
      toast.error(error.message || 'No se pudo eliminar')
      return
    }
    toast.success(`${agent.name} eliminado`)
    if (slug === agent.slug) navigate('/admin/agentes', { replace: true })
  }

  // En lg+ siempre seleccionamos el primero por default si no hay slug.
  useEffect(() => {
    if (slug || agents.length === 0) return
    if (typeof window !== 'undefined' && window.innerWidth >= 1024) {
      navigate(`/admin/agentes/${agents[0].slug}`, { replace: true })
    }
  }, [slug, agents, navigate])

  if (loading) {
    return (
      <div className="grid place-items-center py-20 text-nina-mute text-sm">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    )
  }

  if (agents.length === 0) {
    return (
      <>
        <EmptyState
          icon={Bot}
          title="Aún no hay agentes"
          description="Crea tu primer agente para que arranque a trabajar."
          actions={
            isJunta ? (
              <button
                onClick={() => setAgentModal({ open: true, agentId: null })}
                className="btn-primary text-sm"
              >
                <UserPlus className="w-4 h-4" />
                Crear agente
              </button>
            ) : null
          }
        />
        <NewAgentModal
          open={agentModal.open}
          agentId={agentModal.agentId}
          onClose={closeAgentModal}
        />
      </>
    )
  }

  return (
    <div
      className="grid grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)] gap-4 lg:gap-6 min-h-[480px]"
      style={{ height: 'calc(100dvh - 9rem)' }}
    >
      <div className={slug ? 'hidden lg:block' : 'block min-h-0'}>
        <AgentList
          agents={agents}
          activeSlug={slug}
          isJunta={isJunta}
          onSelect={(s) => navigate(`/admin/agentes/${s}`)}
          onNewAgent={isJunta ? () => setAgentModal({ open: true, agentId: null }) : null}
          onEdit={handleEdit}
          onTogglePause={handleTogglePause}
          onDelete={handleDelete}
        />
      </div>
      <div className={slug ? 'block min-h-0' : 'hidden lg:block min-h-0'}>
        {activeAgent ? (
          <AgentChat
            agent={activeAgent}
            isJunta={isJunta}
            onBack={() => navigate('/admin/agentes')}
            onNewTask={() => setTaskOpen(true)}
            onEdit={() => handleEdit(activeAgent)}
          />
        ) : (
          <div className="panel h-full grid place-items-center text-nina-mute text-sm">
            Selecciona un agente para ver la conversación.
          </div>
        )}
      </div>

      {activeAgent && (
        <NewTaskModal
          open={taskOpen}
          onClose={() => setTaskOpen(false)}
          agent={activeAgent}
        />
      )}

      <NewAgentModal
        open={agentModal.open}
        agentId={agentModal.agentId}
        onClose={closeAgentModal}
      />
    </div>
  )
}

// =====================================================================
// Lista de agentes — sidebar izquierdo
// =====================================================================
function AgentList({
  agents,
  activeSlug,
  isJunta,
  onSelect,
  onNewAgent,
  onEdit,
  onTogglePause,
  onDelete,
}) {
  return (
    <div className="panel h-full overflow-hidden flex flex-col">
      <div className="px-4 py-3 border-b border-nina-line flex items-center justify-between gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-nina-mute">Agentes</div>
          <div className="text-sm font-medium text-nina-chrome mt-0.5">
            {agents.length} activo{agents.length === 1 ? '' : 's'}
          </div>
        </div>
        {onNewAgent && (
          <button
            onClick={onNewAgent}
            className="btn-ghost !p-2 hover:!border-nina-silver/30"
            title="Nuevo agente"
            aria-label="Nuevo agente"
          >
            <UserPlus className="w-4 h-4" />
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto">
        {agents.map((a) => {
          const Icon = agentIcon(a)
          const isActive = a.slug === activeSlug
          // Item es un <div role="button"> en vez de <button> para poder anidar
          // el menú de acciones (que es otro botón) sin chocar con HTML válido.
          return (
            <div
              key={a.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(a.slug)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelect(a.slug)
                }
              }}
              className={`px-4 py-3 flex items-center gap-3 text-left cursor-pointer transition border-b border-nina-line/50 last:border-b-0 outline-none focus-visible:bg-nina-line/30 ${
                isActive ? 'bg-nina-line/40' : 'hover:bg-nina-line/20'
              }`}
            >
              <div className="relative">
                <div className="w-11 h-11 rounded-full grid place-items-center bg-silver-gradient text-nina-black shadow-chrome">
                  <Icon className="w-5 h-5" />
                </div>
                <span
                  className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-nina-panel ${STATUS_DOT[a.status] ?? STATUS_DOT.idle}`}
                />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-nina-chrome truncate">{a.name}</div>
                <div className="text-[11px] text-nina-mute truncate">
                  {STATUS_LABEL[a.status] ?? a.status}
                  {a.last_heartbeat_at ? ` · ${fmtTime(a.last_heartbeat_at)}` : ''}
                </div>
              </div>
              {isJunta ? (
                <AgentActionsMenu
                  agent={a}
                  onEdit={() => onEdit(a)}
                  onTogglePause={() => onTogglePause(a)}
                  onDelete={() => onDelete(a)}
                />
              ) : (
                <ChevronRight className="w-4 h-4 text-nina-mute" />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// =====================================================================
// Chat del agente — header + tabs internas (Paperclip-style)
// =====================================================================
const AGENT_TABS = [
  { id: 'messages', label: 'Mensajes', icon: MessageSquare },
  { id: 'tasks', label: 'Tareas', icon: ListTodo },
  { id: 'instructions', label: 'Instrucciones', icon: BookOpen },
  { id: 'skills', label: 'Habilidades', icon: Wrench },
  { id: 'config', label: 'Configuración', icon: SettingsIcon },
]

function AgentChat({ agent, isJunta, onBack, onNewTask, onEdit }) {
  const Icon = agentIcon(agent)
  const [tab, setTab] = useState('messages')
  const [running, setRunning] = useState(false)
  const { tasks } = useAgentTasks(agent.id)

  // Reset al cambiar de agente
  useEffect(() => {
    setTab('messages')
  }, [agent.id])

  const activeTasks = tasks.filter((t) => t.status === 'to_do' || t.status === 'in_progress')

  // Dispara un tick manual del agente sin esperar al cron de cada minuto.
  // Llama la Edge Function run-agent-step con el JWT del usuario actual.
  const handleRunTick = async () => {
    if (running) return
    setRunning(true)
    const t = toast.loading(`Ejecutando tick de ${agent.name}…`)
    try {
      const { data, error } = await supabase.functions.invoke('run-agent-step', {
        body: { agent_slug: agent.slug },
      })
      if (error) throw error
      const finished = data?.finished
      const iterations = data?.iterations ?? 0
      const reason = data?.reason
      toast.success(
        finished
          ? reason === 'no active tasks'
            ? 'Sin tareas activas para ejecutar'
            : `Tick completado · ${iterations} iter${iterations === 1 ? '' : 's'}`
          : `Tick parcial · ${iterations} iters`,
        { id: t },
      )
    } catch (e) {
      toast.error(e?.message || 'No se pudo ejecutar', { id: t })
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="panel h-full overflow-hidden flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-nina-line flex items-center gap-3">
        <button
          onClick={onBack}
          className="lg:hidden text-nina-mute hover:text-nina-chrome transition p-1"
          aria-label="Volver a la lista"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="relative">
          <div className="w-10 h-10 rounded-full grid place-items-center bg-silver-gradient text-nina-black shadow-chrome">
            <Icon className="w-5 h-5" />
          </div>
          <span
            className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-nina-panel ${STATUS_DOT[agent.status] ?? STATUS_DOT.idle}`}
          />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-nina-chrome truncate">{agent.name}</div>
          <div className="text-[11px] text-nina-mute truncate flex items-center gap-1.5">
            <CircleDot className="w-3 h-3" />
            {STATUS_LABEL[agent.status] ?? agent.status}
            {activeTasks.length > 0 && (
              <span className="ml-2 px-1.5 py-0.5 rounded-full bg-nina-line/60 text-[10px]">
                {activeTasks.length} tarea{activeTasks.length === 1 ? '' : 's'} activa{activeTasks.length === 1 ? '' : 's'}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={handleRunTick}
          disabled={running}
          className="btn-ghost !py-1.5 !px-3 text-xs flex items-center gap-1"
          title="Ejecutar un tick ahora (sin esperar al cron)"
        >
          {running ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Play className="w-3.5 h-3.5" />
          )}
          <span className="hidden sm:inline">{running ? 'Ejecutando…' : 'Ejecutar tick'}</span>
        </button>
        <button onClick={onNewTask} className="btn-ghost !py-1.5 !px-3 text-xs flex items-center gap-1">
          <Plus className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Nueva tarea</span>
        </button>
      </div>

      {/* Tabs */}
      <div className="px-2 sm:px-4 border-b border-nina-line overflow-x-auto">
        <div className="flex gap-0 min-w-max">
          {AGENT_TABS.map((t) => {
            const TabIcon = t.icon
            const isActive = tab === t.id
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`relative flex items-center gap-1.5 px-3 py-2.5 text-[12px] font-medium transition ${
                  isActive ? 'text-nina-chrome' : 'text-nina-mute hover:text-nina-chrome'
                }`}
              >
                <TabIcon className="w-3.5 h-3.5" />
                {t.label}
                {isActive && (
                  <motion.span
                    layoutId="agentTabUnderline"
                    className="absolute left-2 right-2 -bottom-px h-0.5 rounded-full bg-silver-gradient"
                    transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                  />
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {tab === 'messages' && <MessagesTab agentId={agent.id} />}
        {tab === 'tasks' && <TasksTab tasks={tasks} onNewTask={onNewTask} />}
        {tab === 'instructions' && (
          <InstructionsTab agentId={agent.id} isJunta={isJunta} onEdit={onEdit} />
        )}
        {tab === 'skills' && <SkillsTab agentId={agent.id} />}
        {tab === 'config' && (
          <ConfigTab agentId={agent.id} agentBasic={agent} isJunta={isJunta} onEdit={onEdit} />
        )}
      </div>
    </div>
  )
}

// =====================================================================
// Tab · Mensajes (chat real-time)
// =====================================================================
function MessagesTab({ agentId }) {
  const { messages, loading } = useAgentMessages(agentId, 200)
  const scrollRef = useRef(null)

  useEffect(() => {
    if (!scrollRef.current) return
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages.length])

  return (
    <div
      ref={scrollRef}
      className="h-full overflow-y-auto px-3 sm:px-6 py-4 space-y-3"
      style={{
        backgroundImage:
          'radial-gradient(1200px 400px at 50% -10%, rgba(232,232,232,0.04), transparent 70%)',
      }}
    >
      {loading ? (
        <div className="grid place-items-center py-10 text-nina-mute">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : messages.length === 0 ? (
        <div className="grid place-items-center py-10 text-nina-mute text-sm">
          Sin conversación todavía. Asigna una tarea para que arranque.
        </div>
      ) : (
        messages.map((m) => <MessageBubble key={m.id} message={m} />)
      )}
    </div>
  )
}

// =====================================================================
// Tab · Tareas (mini-kanban del agente)
// =====================================================================
function TasksTab({ tasks, onNewTask }) {
  const COLS = [
    { key: 'to_do', label: 'Por hacer', color: 'text-nina-chrome' },
    { key: 'in_progress', label: 'En progreso', color: 'text-emerald-300' },
    { key: 'blocked', label: 'Bloqueadas', color: 'text-amber-300' },
    { key: 'needs_review', label: 'Para revisar', color: 'text-nina-chrome' },
    { key: 'done', label: 'Hechas', color: 'text-nina-mute' },
  ]
  const grouped = COLS.reduce((acc, c) => {
    acc[c.key] = tasks.filter((t) => t.status === c.key)
    return acc
  }, {})

  if (tasks.length === 0) {
    return (
      <div className="h-full grid place-items-center text-center px-6">
        <div className="space-y-3">
          <div className="text-sm text-nina-mute">Este agente aún no tiene tareas.</div>
          <button onClick={onNewTask} className="btn-primary text-xs">
            <Plus className="w-3.5 h-3.5" /> Crear primera tarea
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto px-4 sm:px-6 py-4 space-y-5">
      {COLS.map((c) =>
        grouped[c.key].length > 0 ? (
          <div key={c.key}>
            <div className={`flex items-center gap-2 mb-2 ${c.color}`}>
              <span className="text-[10px] uppercase tracking-[0.2em]">{c.label}</span>
              <span className="text-[10px] text-nina-mute">· {grouped[c.key].length}</span>
            </div>
            <div className="space-y-2">
              {grouped[c.key].map((t) => (
                <div
                  key={t.id}
                  className="rounded-lg border border-nina-line bg-nina-ink p-3 space-y-1"
                >
                  <div className="text-sm text-nina-chrome leading-snug">{t.title}</div>
                  {t.result?.summary && (
                    <div className="text-[12px] text-nina-mute leading-snug">
                      → {t.result.summary}
                    </div>
                  )}
                  <div className="text-[10px] text-nina-mute uppercase tracking-[0.18em]">
                    {fmtTime(t.updated_at ?? t.created_at)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null,
      )}
    </div>
  )
}

// =====================================================================
// Tab · Instrucciones (system prompt)
// =====================================================================
function InstructionsTab({ agentId, isJunta, onEdit }) {
  const { agent: detail, loading } = useAgentDetail(agentId)
  if (loading) {
    return (
      <div className="h-full grid place-items-center text-nina-mute">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    )
  }
  if (!detail) return null
  return (
    <div className="h-full overflow-y-auto px-4 sm:px-6 py-4 space-y-4">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-xs uppercase tracking-[0.2em] text-nina-mute">System prompt</h3>
          <p className="text-[12px] text-nina-mute mt-1 max-w-prose">
            Este texto es lo que el agente "recuerda" en cada turno y define cómo se comporta.
          </p>
        </div>
        {isJunta && (
          <button onClick={onEdit} className="btn-ghost !py-1.5 !px-3 text-xs flex items-center gap-1">
            <Pencil className="w-3.5 h-3.5" />
            Editar
          </button>
        )}
      </header>
      <pre className="rounded-xl border border-nina-line bg-nina-ink p-4 text-[12.5px] font-mono text-nina-chrome leading-relaxed whitespace-pre-wrap break-words">
        {detail.system_prompt}
      </pre>
    </div>
  )
}

// =====================================================================
// Tab · Habilidades (tools permitidas)
// =====================================================================
function SkillsTab({ agentId }) {
  const { agent: detail, loading } = useAgentDetail(agentId)
  const [tools, setTools] = useState([])
  const [loadingTools, setLoadingTools] = useState(false)

  useEffect(() => {
    if (!detail?.allowed_tools?.length) {
      setTools([])
      return
    }
    let active = true
    setLoadingTools(true)
    ;(async () => {
      const { data } = await supabase
        .from('tools_registry')
        .select('name, description, category, requires_approval, is_active')
        .in('name', detail.allowed_tools)
      if (active) {
        setTools(data ?? [])
        setLoadingTools(false)
      }
    })()
    return () => {
      active = false
    }
  }, [detail?.allowed_tools])

  if (loading || loadingTools) {
    return (
      <div className="h-full grid place-items-center text-nina-mute">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    )
  }
  if (!detail) return null

  return (
    <div className="h-full overflow-y-auto px-4 sm:px-6 py-4 space-y-4">
      <header>
        <h3 className="text-xs uppercase tracking-[0.2em] text-nina-mute">
          Tools permitidas · {tools.length}
        </h3>
        <p className="text-[12px] text-nina-mute mt-1">
          El runtime sólo le permite invocar estas. Cualquier otra es rechazada automáticamente.
        </p>
      </header>
      {tools.length === 0 ? (
        <div className="text-sm text-nina-mute">No tiene tools asignadas.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {tools.map((t) => (
            <div
              key={t.name}
              className="rounded-lg border border-nina-line bg-nina-ink p-3 space-y-1"
            >
              <div className="flex items-center gap-2 flex-wrap">
                <code className="text-[12px] font-mono text-nina-chrome">{t.name}</code>
                <span className="text-[9px] uppercase tracking-[0.2em] text-nina-mute">
                  {t.category}
                </span>
                {t.requires_approval && (
                  <span className="text-[9px] uppercase tracking-[0.15em] text-amber-300/80">
                    aprobación
                  </span>
                )}
                {!t.is_active && (
                  <span className="text-[9px] uppercase tracking-[0.15em] text-red-300/80">
                    inactiva
                  </span>
                )}
              </div>
              <div className="text-[11.5px] text-nina-mute leading-snug">{t.description}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// =====================================================================
// Tab · Configuración (modelo, temp, padre, marca)
// =====================================================================
function ConfigTab({ agentId, agentBasic, isJunta, onEdit }) {
  const { agent: detail, loading } = useAgentDetail(agentId)
  const [parentName, setParentName] = useState(null)
  const [brandName, setBrandName] = useState(null)

  useEffect(() => {
    if (!detail) return
    let active = true
    ;(async () => {
      const tasks = []
      if (detail.parent_agent_id) {
        tasks.push(
          supabase
            .from('agents')
            .select('name')
            .eq('id', detail.parent_agent_id)
            .maybeSingle()
            .then(({ data }) => active && setParentName(data?.name ?? '—')),
        )
      } else {
        setParentName('—')
      }
      if (detail.brand_id) {
        tasks.push(
          supabase
            .from('brands')
            .select('name')
            .eq('id', detail.brand_id)
            .maybeSingle()
            .then(({ data }) => active && setBrandName(data?.name ?? '—')),
        )
      } else {
        setBrandName('Global / sin marca')
      }
      await Promise.allSettled(tasks)
    })()
    return () => {
      active = false
    }
  }, [detail])

  if (loading) {
    return (
      <div className="h-full grid place-items-center text-nina-mute">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    )
  }
  if (!detail) return null

  const cfg = detail.config ?? {}

  const Field = ({ label, children }) => (
    <div>
      <div className="text-[10px] uppercase tracking-[0.2em] text-nina-mute mb-1">{label}</div>
      <div className="text-sm text-nina-chrome">{children}</div>
    </div>
  )

  return (
    <div className="h-full overflow-y-auto px-4 sm:px-6 py-4 space-y-5">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-xs uppercase tracking-[0.2em] text-nina-mute">Configuración</h3>
          <p className="text-[12px] text-nina-mute mt-1">
            Modelo, parámetros y pertenencia jerárquica.
          </p>
        </div>
        {isJunta && (
          <button onClick={onEdit} className="btn-ghost !py-1.5 !px-3 text-xs flex items-center gap-1">
            <Pencil className="w-3.5 h-3.5" />
            Editar
          </button>
        )}
      </header>

      <section className="grid grid-cols-1 sm:grid-cols-2 gap-4 panel p-4">
        <Field label="Slug">
          <code className="font-mono text-[12.5px]">{detail.slug}</code>
        </Field>
        <Field label="Rol">{detail.role}</Field>
        {detail.specialty && <Field label="Especialidad">{detail.specialty}</Field>}
        <Field label="Estado">
          <span className="capitalize">{STATUS_LABEL[agentBasic.status] ?? agentBasic.status}</span>
        </Field>
      </section>

      <section className="grid grid-cols-1 sm:grid-cols-2 gap-4 panel p-4">
        <Field label="Marca">{brandName ?? '…'}</Field>
        <Field label="Reporta a">{parentName ?? '…'}</Field>
      </section>

      <section className="grid grid-cols-1 sm:grid-cols-3 gap-4 panel p-4">
        <Field label="Proveedor">{detail.provider}</Field>
        <Field label="Modelo">
          <code className="font-mono text-[12.5px]">{detail.model}</code>
        </Field>
        <Field label="Temperatura">
          <span className="flex items-center gap-1.5">
            <Thermometer className="w-3.5 h-3.5 text-nina-mute" />
            <span className="font-mono">{(cfg.temperature ?? 0.4).toFixed(2)}</span>
          </span>
        </Field>
        <Field label="Max tokens">{cfg.max_tokens ?? 1500}</Field>
      </section>
    </div>
  )
}

// =====================================================================
// Una burbuja de mensaje — diferenciada por role
// =====================================================================
function MessageBubble({ message }) {
  const { role, content, tool_calls, tool_call_id, created_at } = message

  if (role === 'system') return null

  if (role === 'tool') {
    let parsed = null
    try {
      parsed = JSON.parse(content || '{}')
    } catch {
      parsed = { _raw: content }
    }
    const ok = parsed?.ok === true
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex justify-center"
      >
        <div
          className={`max-w-[85%] rounded-xl px-3 py-2 text-[11px] border flex items-start gap-2 ${
            ok
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-200'
              : 'bg-red-500/10 border-red-500/20 text-red-200'
          }`}
        >
          <Wrench className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <div className="space-y-1 min-w-0">
            <div className="uppercase tracking-[0.18em] opacity-70">
              Resultado de tool · {ok ? 'éxito' : 'error'}
            </div>
            <pre className="whitespace-pre-wrap break-words font-mono text-[10.5px] opacity-90">
              {ok
                ? JSON.stringify(parsed.data ?? null, null, 2)
                : parsed.error || JSON.stringify(parsed)}
            </pre>
          </div>
        </div>
      </motion.div>
    )
  }

  const isUser = role === 'user'
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
    >
      <div className="max-w-[85%] sm:max-w-[75%] space-y-2">
        <div
          className={`rounded-2xl px-4 py-2.5 ${
            isUser
              ? 'bg-silver-gradient text-nina-black rounded-br-md shadow-chrome'
              : 'bg-nina-line/60 text-nina-chrome rounded-bl-md border border-nina-line'
          }`}
        >
          {content && (
            <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">{content}</div>
          )}
          {Array.isArray(tool_calls) && tool_calls.length > 0 && (
            <div className="mt-2 space-y-1.5">
              {tool_calls.map((tc) => (
                <ToolCallChip key={tc.id} call={tc} />
              ))}
            </div>
          )}
        </div>
        <div className={`text-[10px] text-nina-mute ${isUser ? 'text-right' : ''}`}>
          {fmtTime(created_at)}
        </div>
      </div>
    </motion.div>
  )
}

function ToolCallChip({ call }) {
  let args = null
  try {
    args = JSON.parse(call?.function?.arguments || '{}')
  } catch {
    args = null
  }
  const summary = args
    ? Object.entries(args)
        .slice(0, 2)
        .map(([k, v]) => {
          const val = typeof v === 'string' ? v : JSON.stringify(v)
          return `${k}: ${val.length > 60 ? val.slice(0, 60) + '…' : val}`
        })
        .join(' · ')
    : ''
  return (
    <div className="rounded-lg bg-nina-black/40 border border-nina-line px-2.5 py-1.5 text-[11px] flex items-start gap-2 text-nina-chrome">
      <Hammer className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-nina-silver" />
      <div className="min-w-0">
        <div className="font-mono font-medium">{call.function.name}</div>
        {summary && (
          <div className="text-nina-mute truncate font-mono text-[10.5px]">{summary}</div>
        )}
      </div>
    </div>
  )
}

// =====================================================================
// Modal · crear tarea para este agente
// =====================================================================
function NewTaskModal({ open, onClose, agent }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState(3)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setTitle('')
    setDescription('')
    setPriority(3)
  }, [open])

  const submit = async (e) => {
    e.preventDefault()
    if (!title.trim()) {
      toast.error('Pon al menos un título')
      return
    }
    setBusy(true)
    try {
      const { error } = await supabase.from('tasks').insert({
        brand_id: agent.brand_id ?? null,
        agent_id: agent.id,
        title: title.trim(),
        description: description.trim() || null,
        status: 'to_do',
        priority: Number(priority) || 3,
      })
      if (error) throw error
      toast.success('Tarea creada — el agente la tomará en el siguiente tick')
      onClose()
    } catch (err) {
      toast.error(err.message || 'No se pudo crear la tarea')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Nueva tarea para ${agent.name}`}>
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
            className="input min-h-[120px] resize-y"
            placeholder="Explica el objetivo, datos relevantes, criterio de éxito, deadline..."
          />
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
