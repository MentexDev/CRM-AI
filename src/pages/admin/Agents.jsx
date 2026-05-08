import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowLeft,
  Bot,
  ChevronRight,
  CircleDot,
  Crown,
  Hammer,
  Loader2,
  Plus,
  Sparkles,
  Wrench,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useAgents } from '../../hooks/useAgents'
import { useAgentMessages } from '../../hooks/useAgentMessages'
import { useAgentTasks } from '../../hooks/useAgentTasks'
import EmptyState from '../../components/EmptyState'
import Modal from '../../components/Modal'
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

function agentIcon(agent) {
  if (!agent) return Bot
  if (agent.role === 'ceo_global') return Crown
  if (agent.role === 'brand_manager') return Sparkles
  return Bot
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
  const activeAgent = useMemo(() => agents.find((a) => a.slug === slug), [agents, slug])
  const [taskOpen, setTaskOpen] = useState(false)

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
      <EmptyState
        title="Aún no hay agentes"
        description="Crea agentes desde el panel de marcas para que empiecen a trabajar."
      />
    )
  }

  return (
    <div
      className="grid grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)] gap-4 lg:gap-6 min-h-[480px]"
      style={{ height: 'calc(100dvh - 9rem)' }}
    >
      <div className={slug ? 'hidden lg:block' : 'block min-h-0'}>
        <AgentList agents={agents} activeSlug={slug} onSelect={(s) => navigate(`/admin/agentes/${s}`)} />
      </div>
      <div className={slug ? 'block min-h-0' : 'hidden lg:block min-h-0'}>
        {activeAgent ? (
          <AgentChat
            agent={activeAgent}
            onBack={() => navigate('/admin/agentes')}
            onNewTask={() => setTaskOpen(true)}
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
    </div>
  )
}

// =====================================================================
// Lista de agentes — sidebar izquierdo
// =====================================================================
function AgentList({ agents, activeSlug, onSelect }) {
  return (
    <div className="panel h-full overflow-hidden flex flex-col">
      <div className="px-4 py-3 border-b border-nina-line">
        <div className="text-[10px] uppercase tracking-[0.2em] text-nina-mute">Agentes</div>
        <div className="text-sm font-medium text-nina-chrome mt-0.5">
          {agents.length} activo{agents.length === 1 ? '' : 's'}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {agents.map((a) => {
          const Icon = agentIcon(a)
          const isActive = a.slug === activeSlug
          return (
            <button
              key={a.id}
              onClick={() => onSelect(a.slug)}
              className={`w-full px-4 py-3 flex items-center gap-3 text-left transition border-b border-nina-line/50 last:border-b-0 ${
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
              <ChevronRight className="w-4 h-4 text-nina-mute" />
            </button>
          )
        })}
      </div>
    </div>
  )
}

// =====================================================================
// Chat del agente — centro
// =====================================================================
function AgentChat({ agent, onBack, onNewTask }) {
  const Icon = agentIcon(agent)
  const { messages, loading } = useAgentMessages(agent.id, 200)
  const { tasks } = useAgentTasks(agent.id)
  const scrollRef = useRef(null)

  // Auto-scroll al fondo cuando llegan mensajes nuevos
  useEffect(() => {
    if (!scrollRef.current) return
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages.length])

  const activeTasks = tasks.filter((t) => t.status === 'to_do' || t.status === 'in_progress')

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
        <button onClick={onNewTask} className="btn-ghost !py-1.5 !px-3 text-xs flex items-center gap-1">
          <Plus className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Nueva tarea</span>
        </button>
      </div>

      {/* Hilo */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 space-y-3"
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
