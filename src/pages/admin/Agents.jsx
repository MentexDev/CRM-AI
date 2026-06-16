import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowLeft,
  ArrowUp,
  BookOpen,
  Bot,
  Calculator,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Crown,
  Database,
  Globe,
  Hammer,
  Image as ImageIcon,
  ListTodo,
  Loader2,
  MessageSquare,
  MessageSquarePlus,
  Mic,
  MicOff,
  Package,
  Paperclip,
  Pencil,
  Play,
  Plug,
  Plus,
  Settings as SettingsIcon,
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
  Thermometer,
  TrendingUp,
  UserPlus,
  Wrench,
  X,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useAgents } from '../../hooks/useAgents'
import { useAgentDetail } from '../../hooks/useAgentDetail'
import { useAgentMessages } from '../../hooks/useAgentMessages'
import { useAgentTasks } from '../../hooks/useAgentTasks'
import { useConversations } from '../../hooks/useConversations'
import { ConversationMenu } from '../../components/ConversationMenu'
import { TasksBoard } from './Tasks'
import { useVoiceTranscription } from '../../hooks/useVoiceTranscription'
import { useAuth } from '../../context/AuthContext'
import { useConfirm } from '../../components/ConfirmDialog'
import EmptyState from '../../components/EmptyState'
import Modal from '../../components/Modal'
import NewAgentModal from '../../components/NewAgentModal'
import AgentActionsMenu from '../../components/AgentActionsMenu'
import ToolResultBubble from '../../components/ToolResultBubble'
import Markdown from '../../components/Markdown'
import VoiceOverlay from '../../components/VoiceOverlay'
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
  const [searchParams, setSearchParams] = useSearchParams()
  const { agents, loading } = useAgents()
  const { isJunta } = useAuth()
  const confirm = useConfirm()
  const activeAgent = useMemo(() => agents.find((a) => a.slug === slug), [agents, slug])
  const [taskOpen, setTaskOpen] = useState(false)
  const [agentModal, setAgentModal] = useState({ open: false, agentId: null })
  const [running, setRunning] = useState(false)

  // Abrir el modal de "nuevo agente" cuando el sidebar pide ?new=1
  useEffect(() => {
    if (searchParams.get('new') === '1' && isJunta) {
      setAgentModal({ open: true, agentId: null })
      const next = new URLSearchParams(searchParams)
      next.delete('new')
      setSearchParams(next, { replace: true })
    }
  }, [searchParams, isJunta, setSearchParams])

  // El query param `c` decide la vista del agente:
  //   sin c     → "home" del agente (composer + historial de conversaciones)
  //   c=<uuid>  → chat de esa conversación
  const activeConversationId = searchParams.get('c') || null

  const setConversation = (id) => {
    const next = new URLSearchParams(searchParams)
    next.set('c', id)
    setSearchParams(next, { replace: true })
  }
  const goHome = () => {
    const next = new URLSearchParams(searchParams)
    next.delete('c')
    next.delete('canvas') // salir del chat cierra el canvas — no dejar ?canvas pegado (re-abría el avance)
    setSearchParams(next, { replace: true })
  }

  const closeAgentModal = () => setAgentModal({ open: false, agentId: null })

  const handleEdit = (agent) => setAgentModal({ open: true, agentId: agent.id })

  // Tick manual del agente activo, llamando run-agent-step con el JWT del user.
  const handleRunTick = async () => {
    if (!activeAgent || running) return
    setRunning(true)
    const t = toast.loading(`Ejecutando tick de ${activeAgent.name}…`)
    try {
      const { data, error } = await supabase.functions.invoke('run-agent-step', {
        body: { agent_slug: activeAgent.slug },
      })
      if (error) throw error
      const finished = data?.finished
      const iterations = data?.iterations ?? 0
      const reason = data?.reason
      toast.success(
        finished
          ? reason === 'no active tasks'
            ? 'Sin tareas activas'
            : `Tick · ${iterations} iter${iterations === 1 ? '' : 's'}`
          : `Tick parcial · ${iterations} iters`,
        { id: t },
      )
    } catch (e) {
      toast.error(e?.message || 'No se pudo ejecutar', { id: t })
    } finally {
      setRunning(false)
    }
  }

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
    <div className="flex h-[calc(100dvh-3rem)] lg:h-screen min-w-0">
      <div className="flex-1 min-w-0">
        {activeAgent ? (
          <AgentWorkspace
            agent={activeAgent}
            isJunta={isJunta}
            conversationId={activeConversationId}
            onOpenConversation={setConversation}
            onGoHome={goHome}
            onEdit={() => handleEdit(activeAgent)}
            onTogglePause={() => handleTogglePause(activeAgent)}
            onDelete={() => handleDelete(activeAgent)}
            onRunTick={handleRunTick}
            running={running}
            onNewTask={() => setTaskOpen(true)}
          />
        ) : (
          <div className="h-full grid place-items-center text-nina-mute text-sm text-center px-6">
            Selecciona un agente desde el menú de la izquierda.
          </div>
        )}
      </div>

      {activeAgent && (
        <NewTaskModal open={taskOpen} onClose={() => setTaskOpen(false)} agent={activeAgent} />
      )}

      <NewAgentModal open={agentModal.open} agentId={agentModal.agentId} onClose={closeAgentModal} />
    </div>
  )
}

// =====================================================================
// Workspace del agente — barra superior full-width (identidad + acciones
// + tabs) y abajo el contenido (Inicio/chat · Tareas · Prompt · Tools · Config).
// =====================================================================
const WORKSPACE_TABS = [
  { id: 'main', label: 'Inicio', icon: MessageSquare },
  { id: 'tasks', label: 'Tareas', icon: ListTodo },
  { id: 'instructions', label: 'Prompt', icon: BookOpen },
  { id: 'skills', label: 'Tools', icon: Wrench },
  { id: 'connectors', label: 'Conectores', icon: Plug },
  { id: 'config', label: 'Config', icon: SettingsIcon },
]

function AgentWorkspace({
  agent,
  isJunta,
  conversationId,
  onOpenConversation,
  onGoHome,
  onEdit,
  onTogglePause,
  onDelete,
  onRunTick,
  running,
  onNewTask,
}) {
  const [view, setView] = useState('main')
  // Mensaje enviado desde el perfil que sembramos en el chat al navegar, para
  // que se vea de inmediato (sin el flash de "Sin mensajes todavía") mientras
  // llega por realtime. El dedup de MessagesTab lo reemplaza por el real.
  const [pendingMsg, setPendingMsg] = useState(null)
  const { tasks } = useAgentTasks(agent.id)
  const { conversations } = useConversations({ agentId: agent.id })
  const activeConv = conversations.find((c) => c.id === conversationId) ?? null
  const activeTaskCount = tasks.filter(
    (t) => t.status === 'to_do' || t.status === 'in_progress',
  ).length

  // ¿Estamos viendo el chat de una conversación? Ahí ocultamos la barra de tabs.
  const inChat = Boolean(conversationId) && view === 'main'

  // Al abrir una conversación, mostramos el chat (vista Inicio).
  useEffect(() => {
    if (conversationId) setView('main')
  }, [conversationId])
  // Al cambiar de agente, volvemos a Inicio.
  useEffect(() => {
    setView('main')
  }, [agent.id])

  return (
    <div className="h-full flex flex-col">
      {/* Barra superior — tabs + acciones. Se oculta cuando estás en un chat. */}
      {!inChat && (
      <div className="border-b border-nina-line bg-nina-panel/40 shrink-0 flex items-stretch gap-2 px-2 sm:px-4">
        {/* Tabs a la izquierda */}
        <div className="flex items-stretch gap-1 overflow-x-auto flex-1 min-w-0">
          {WORKSPACE_TABS.map((t) => {
            const TabIcon = t.icon
            const isActive = view === t.id
            const showBadge = t.id === 'tasks' && activeTaskCount > 0
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setView(t.id)}
                className={`relative flex items-center gap-2 px-3.5 py-5 text-[13.5px] font-medium transition whitespace-nowrap ${
                  isActive ? 'text-nina-chrome' : 'text-nina-mute hover:text-nina-chrome'
                }`}
                title={t.label}
              >
                <TabIcon className="w-[18px] h-[18px]" />
                <span>{t.label}</span>
                {showBadge && (
                  <span className="ml-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-amber-400/90 text-nina-black text-[10px] font-bold leading-[18px] text-center">
                    {activeTaskCount}
                  </span>
                )}
                {isActive && (
                  <motion.span
                    layoutId="agentWorkspaceTab"
                    className="absolute left-2 right-2 bottom-0 h-0.5 rounded-full bg-silver-gradient"
                    transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                  />
                )}
              </button>
            )
          })}
        </div>

        {/* Acciones a la derecha — sin borde, solo en hover */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={onRunTick}
            disabled={running}
            className="flex items-center gap-1.5 py-2 px-3 rounded-lg text-[12px] text-nina-mute hover:text-nina-chrome hover:bg-nina-line/40 transition disabled:opacity-50"
            title="Ejecutar un tick ahora"
          >
            {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            <span className="hidden sm:inline">{running ? 'Ejecutando…' : 'Tick'}</span>
          </button>
          <button
            onClick={onNewTask}
            className="flex items-center gap-1.5 py-2 px-3 rounded-lg text-[12px] text-nina-mute hover:text-nina-chrome hover:bg-nina-line/40 transition"
            title="Crear nueva tarea"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Nueva tarea</span>
          </button>
          {isJunta && (
            <AgentActionsMenu
              agent={agent}
              onEdit={onEdit}
              onTogglePause={onTogglePause}
              onDelete={onDelete}
            />
          )}
        </div>
      </div>
      )}

      {/* Contenido */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {view === 'main' &&
          (conversationId ? (
            <MessagesTab
              agent={agent}
              conversationId={conversationId}
              conversation={activeConv}
              onConversationCreated={onOpenConversation}
              onGoHome={onGoHome}
              seedMessage={pendingMsg}
              onSeedConsumed={() => setPendingMsg(null)}
            />
          ) : (
            <AgentHome agent={agent} onOpenConversation={onOpenConversation} onUserSend={setPendingMsg} />
          ))}
        {view === 'tasks' && <TasksBoard agentId={agent.id} embedded />}
        {view === 'instructions' && (
          <InstructionsTab agentId={agent.id} isJunta={isJunta} onEdit={onEdit} />
        )}
        {view === 'skills' && <SkillsTab agentId={agent.id} />}
        {view === 'connectors' && <ConnectorsTab agentId={agent.id} agentBasic={agent} />}
        {view === 'config' && (
          <ConfigTab agentId={agent.id} agentBasic={agent} isJunta={isJunta} onEdit={onEdit} />
        )}
      </div>    </div>
  )
}


// =====================================================================
// Home del agente — composer para iniciar + historial de conversaciones
// (réplica del "project view" de Manus, pero por perfil de agente).
// =====================================================================
function AgentHome({ agent, onOpenConversation, onUserSend }) {
  const { conversations, loading } = useConversations({ agentId: agent.id })
  const Icon = agentIcon(agent)

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-4 sm:px-8 py-6 sm:py-10">
        {/* Header del agente */}
        <div className="flex items-center gap-3 mb-6">
          <div className="relative shrink-0">
            <div className="w-12 h-12 rounded-2xl grid place-items-center bg-silver-gradient text-nina-black shadow-chrome">
              <Icon className="w-6 h-6" />
            </div>
            <span
              className={`absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full border-2 border-nina-ink ${STATUS_DOT[agent.status] ?? STATUS_DOT.idle}`}
            />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-display text-nina-chrome truncate">{agent.name}</h1>
            <p className="text-[12px] text-nina-mute">{STATUS_LABEL[agent.status] ?? agent.status}</p>
          </div>
        </div>

        {/* Composer para iniciar una conversación */}
        <ChatComposer
          agent={agent}
          conversationId={null}
          onConversationCreated={onOpenConversation}
          onUserSend={onUserSend}
          bare
        />

        {/* Historial de conversaciones del agente */}
        <div className="mt-8">
          <h2 className="text-sm font-medium text-nina-chrome">Conversaciones</h2>
          <p className="text-[12px] text-nina-mute mb-3">Tu historial de charlas con {agent.name}.</p>
          {loading ? (
            <div className="py-6 grid place-items-center text-nina-mute">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : conversations.length === 0 ? (
            <div className="text-[13px] text-nina-mute py-4">
              Aún no hay conversaciones. Escribe arriba para empezar la primera.
            </div>
          ) : (
            <div className="space-y-1">
              {conversations.map((c) => (
                <button
                  key={c.id}
                  onClick={() => onOpenConversation(c.id)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-nina-line/30 transition text-left"
                >
                  <MessageSquare className="w-4 h-4 text-nina-mute shrink-0" />
                  <span className="flex-1 min-w-0 text-[13.5px] text-nina-chrome truncate">
                    {c.title || 'Conversación'}
                  </span>
                  <span className="text-[11px] text-nina-mute shrink-0">{fmtTime(c.last_message_at)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// =====================================================================
// Tab · Mensajes (chat real-time + composer para hablarle al agente)
// =====================================================================
function MessagesTab({ agent, conversationId, conversation, onConversationCreated, onGoHome, seedMessage, onSeedConsumed }) {
  const { messages, loading } = useAgentMessages(agent.id, conversationId, 200)
  const [optimistic, setOptimistic] = useState([])
  const [thinking, setThinking] = useState(false)
  const scrollRef = useRef(null)

  // Cuando un mensaje real del usuario llega (vía realtime / fetch), quitamos
  // el optimista equivalente para no duplicarlo.
  useEffect(() => {
    setOptimistic((prev) =>
      prev.filter(
        (o) => !messages.some((m) => m.role === 'user' && m.content === o.content),
      ),
    )
  }, [messages])

  // Al cambiar de conversación, limpiamos thinking y sembramos (si venimos del
  // perfil) el mensaje del usuario como optimista, para verlo al instante sin el
  // flash de "Sin mensajes todavía". El dedup de arriba lo reemplaza por el real.
  useEffect(() => {
    setThinking(false)
    if (seedMessage) {
      setOptimistic([
        {
          id: `opt-seed-${conversationId}`,
          role: 'user',
          content: seedMessage,
          created_at: new Date().toISOString(),
          optimistic: true,
        },
      ])
      onSeedConsumed?.()
    } else {
      setOptimistic([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId])

  const addOptimistic = (content) => {
    setOptimistic((prev) => [
      ...prev,
      { id: `opt-${Date.now()}`, role: 'user', content, created_at: new Date().toISOString(), optimistic: true },
    ])
    setThinking(true)
  }

  const allMessages = [...messages, ...optimistic]

  // Canvas (F3): detecta el ÚLTIMO artefacto de email (de la tool compose_email)
  // en el hilo para mostrarlo en el split-view a la derecha. Lee el JSON COMPLETO
  // de messages.content (por eso importa guardar el resultado íntegro en la BD).
  const emailArtifact = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m.role !== 'tool' || typeof m.content !== 'string') continue
      try {
        const p = JSON.parse(m.content)
        if (p?.ok && p?.data?.kind === 'email' && p.data.html) {
          return { subject: p.data.subject ?? '(sin asunto)', html: String(p.data.html), key: m.id }
        }
      } catch {
        /* no es JSON / no es artefacto */
      }
    }
    return null
  }, [messages])
  const [canvasOpen, setCanvasOpen] = useState(false)
  // Auto-abrimos el canvas SOLO cuando el agente genera un email NUEVO mientras miramos
  // el hilo. Entrar o VOLVER a un hilo que ya traía un email NO fuerza el avance (para
  // eso está el botón "Avance") — antes se reabría en cada visita y "secuestraba" la vista.
  const initialArtifactKey = useRef(undefined)
  useEffect(() => {
    // Fijamos el artefacto "que ya venía en el hilo" en la primera carga de historia.
    if (initialArtifactKey.current === undefined && messages.length > 0) {
      initialArtifactKey.current = emailArtifact?.key ?? null
    }
    if (
      initialArtifactKey.current !== undefined &&
      emailArtifact &&
      emailArtifact.key !== initialArtifactKey.current
    ) {
      setCanvasOpen(true)
    }
  }, [emailArtifact?.key, messages.length])

  // Marcamos ?canvas=1 en la URL cuando el canvas está abierto → el layout oculta
  // el sidebar y le da más espacio. Lo limpiamos al cerrar y al salir del chat.
  const [, setSearchParams] = useSearchParams()
  const hasArtifact = !!emailArtifact
  useEffect(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (canvasOpen && hasArtifact) next.set('canvas', '1')
      else next.delete('canvas')
      return next
    }, { replace: true })
  }, [canvasOpen, hasArtifact])
  useEffect(
    () => () => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        next.delete('canvas')
        return next
      }, { replace: true })
    },
    [],
  )

  // Ancho del canvas (px) ajustable arrastrando el divisor. Con límites para que
  // ni el chat ni el canvas queden inservibles. `dragging` desactiva la animación
  // de ancho mientras arrastras (para que siga al puntero sin lag).
  const [canvasWidth, setCanvasWidth] = useState(() =>
    Math.min(760, Math.max(420, Math.round((typeof window !== 'undefined' ? window.innerWidth : 1280) * 0.5))),
  )
  const [dragging, setDragging] = useState(false)
  const startResize = (e) => {
    e.preventDefault()
    setDragging(true)
    const onMove = (ev) => {
      const w = window.innerWidth - ev.clientX
      setCanvasWidth(Math.max(420, Math.min(w, window.innerWidth - 460)))
    }
    const onUp = () => {
      setDragging(false)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  useEffect(() => {
    if (!scrollRef.current) return
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [allMessages.length, thinking])

  return (
    <div className="h-full flex flex-row">
      {/* Capa transparente durante el arrastre: cubre el iframe del canvas para
          que NO se trague los eventos del puntero (si no, al mover rápido el cursor
          entra al iframe y el resize pierde el rastro). */}
      {dragging && <div className="fixed inset-0 z-50 cursor-col-resize select-none" />}
      <div className="flex-1 flex flex-col min-w-0">
      {/* Header de conversación — volver al home + nueva conversación */}
      <div className="px-3 sm:px-5 py-2 border-b border-nina-line/60 flex items-center justify-between gap-2 shrink-0">
        <button
          onClick={onGoHome}
          className="flex items-center gap-1.5 text-[12px] text-nina-mute hover:text-nina-chrome transition min-w-0"
          title="Volver al inicio del agente"
        >
          <ArrowLeft className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{agent.name}</span>
        </button>
        <div className="flex items-center gap-1 shrink-0">
          {emailArtifact && (
            <button
              onClick={() => setCanvasOpen((o) => !o)}
              className={`btn-ghost !py-1 !px-2 text-[11px] flex items-center gap-1 ${
                canvasOpen ? 'text-nina-chrome bg-nina-line/40' : ''
              }`}
              title={canvasOpen ? 'Ocultar el canvas' : 'Ver el avance en el canvas'}
            >
              <ImageIcon className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Avance</span>
            </button>
          )}
          <button
            onClick={onGoHome}
            className="btn-ghost !py-1 !px-2 text-[11px] flex items-center gap-1"
            title="Empezar una conversación nueva"
          >
            <MessageSquarePlus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Nueva</span>
          </button>
          {conversation && (
            <ConversationMenu
              conv={conversation}
              onAfterDelete={onGoHome}
              buttonClassName="w-7 h-7 grid place-items-center rounded-lg text-nina-mute hover:text-nina-chrome hover:bg-nina-line/40 transition"
              menuClassName="right-0 top-9"
            />
          )}
        </div>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-6 py-4"
        style={{
          backgroundImage:
            'radial-gradient(1200px 400px at 50% -10%, rgba(232,232,232,0.04), transparent 70%)',
        }}
      >
        <div className="max-w-3xl mx-auto w-full space-y-3">
          {loading && allMessages.length === 0 ? (
            <div className="grid place-items-center py-10 text-nina-mute">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : allMessages.length === 0 ? (
            <div className="grid place-items-center py-10 text-nina-mute text-sm text-center px-6">
              Sin mensajes en esta conversación todavía.
            </div>
          ) : (
            groupTimeline(allMessages).map((it) =>
              it.kind === 'steps' ? (
                <StepsGroup key={it.key} steps={it.steps} />
              ) : it.kind === 'note' ? (
                <SystemNote key={it.key} message={it.message} />
              ) : (
                <MessageBubble key={it.key} message={it.message} hideTools />
              ),
            )
          )}
          {thinking && <ThinkingIndicator name={agent.name} />}
        </div>
      </div>
      <ChatComposer
        agent={agent}
        conversationId={conversationId}
        onConversationCreated={onConversationCreated}
        onUserSend={addOptimistic}
        onSettled={() => setThinking(false)}
      />
      </div>
      <AnimatePresence>
        {canvasOpen && emailArtifact && (
          <motion.aside
            key="canvas"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: canvasWidth, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: dragging ? 0 : 0.32, ease: 'easeOut' }}
            className="hidden md:flex shrink-0 relative overflow-hidden border-l border-nina-line bg-nina-panel/40 flex-col min-w-0"
          >
            {/* Divisor arrastrable — ajusta el ancho chat↔canvas (con límites) */}
            <div
              onPointerDown={startResize}
              className="absolute left-0 top-0 h-full w-1.5 z-20 cursor-col-resize hover:bg-nina-silver/20 transition-colors"
              title="Arrastra para ajustar el ancho"
            >
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center text-nina-mute/70">
                <ChevronLeft className="w-3 h-3 -mr-1.5" />
                <ChevronRight className="w-3 h-3 -ml-1.5" />
              </div>
            </div>
            <EmailCanvas artifact={emailArtifact} onClose={() => setCanvasOpen(false)} />
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  )
}

// Canvas (F3) — split-view tipo NeuralOS. Hoy renderiza el preview en vivo del
// correo HTML (artefacto de compose_email); luego se le suman pestañas (browser, docs).
function EmailCanvas({ artifact, onClose }) {
  return (
    <div className="flex flex-col min-w-0 w-full h-full">
      {/* Barra de pestañas estilo Chrome */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-nina-line/60 shrink-0">
        <div className="flex items-center gap-2 pl-2 pr-3 h-8 rounded-lg bg-nina-line/40 text-[12px] text-nina-chrome min-w-0">
          <span className="w-4 h-4 rounded grid place-items-center bg-silver-gradient text-nina-black shrink-0">
            <MessageSquare className="w-2.5 h-2.5" />
          </span>
          <span className="truncate">{artifact.subject}</span>
        </div>
        <div className="flex-1" />
        <button
          onClick={onClose}
          className="w-7 h-7 grid place-items-center rounded-lg text-nina-mute hover:text-nina-chrome hover:bg-nina-line/40 transition"
          title="Cerrar canvas"
          aria-label="Cerrar canvas"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      {/* Preview del correo en un iframe aislado (sin scripts) */}
      <div className="flex-1 min-h-0 bg-nina-ink p-3">
        <iframe
          title="Preview del correo NINA"
          srcDoc={artifact.html}
          sandbox=""
          className="w-full h-full rounded-lg bg-white border border-nina-line"
        />
      </div>
      <div className="px-3 py-2 border-t border-nina-line/60 text-[11px] text-nina-mute shrink-0">
        Vista previa en vivo · cuando esté lista, pídele al agente que la envíe con{' '}
        <span className="text-nina-chrome">send_email</span>.
      </div>
    </div>
  )
}

// Indicador "está pensando" con 3 puntos saltando en ola.
function ThinkingIndicator({ name }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex justify-start"
    >
      <div className="flex items-center gap-2 px-1 py-1 text-[12px] text-nina-mute">
        <span>{name} está pensando</span>
        <span className="flex items-end gap-0.5">
          <span className="w-1.5 h-1.5 rounded-full bg-nina-mute animate-bounce" style={{ animationDelay: '0ms' }} />
          <span className="w-1.5 h-1.5 rounded-full bg-nina-mute animate-bounce" style={{ animationDelay: '150ms' }} />
          <span className="w-1.5 h-1.5 rounded-full bg-nina-mute animate-bounce" style={{ animationDelay: '300ms' }} />
        </span>
      </div>
    </motion.div>
  )
}

// Sugerencias rápidas según el rol del agente — aparecen al enfocar el input.
function quickPromptsFor(agent) {
  if (!agent) return []
  if (agent.role === 'ceo_global') {
    return [
      'Dame el reporte del estado del holding',
      '¿Qué decisiones necesitan mi aprobación?',
      'Resume el avance de las marcas',
      '¿Qué tareas están bloqueadas?',
    ]
  }
  if (agent.role === 'brand_manager') {
    return [
      '¿Cómo va la marca esta semana?',
      'Dame ideas para la próxima campaña',
      'Revisa los KPIs y dame alertas',
      'Consulta el brain sobre nuestra política de descuentos',
    ]
  }
  // Especialistas
  return [
    '¿En qué estás trabajando ahora?',
    'Dame un resumen de tu última tarea',
    '¿Qué necesitas de mí para avanzar?',
  ]
}

// =====================================================================
// Composer · le escribes (o le hablas) al agente y responde en el chat.
// Layout inspirado en NeuralOS: textarea arriba + toolbar abajo con
// attach / settings / agent pill · ⌘K · model pill / mic / send.
// =====================================================================
// Catálogo de modelos elegibles desde la pastilla del chat. Cada entrada fija
// provider + model JUNTOS (coherentes); al elegir uno se persiste en el agente.
// El backend lee provider/model de la BD, así que el cambio aplica al siguiente turno.
const MODEL_CATALOG = [
  { provider: 'groq', model: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B', hint: 'Groq · gratis · rápido' },
  { provider: 'openrouter', model: 'moonshotai/kimi-k2.5', label: 'Kimi K2.5', hint: 'OpenRouter · 262k · créditos' },
  { provider: 'openrouter', model: 'moonshotai/kimi-k2.6', label: 'Kimi K2.6', hint: 'OpenRouter · más nuevo · créditos' },
  { provider: 'ollama', model: 'gpt-oss:120b', label: 'GPT-OSS 120B', hint: 'Ollama · 128k · créditos' },
]

// Si el agente no trae `provider` explícito, lo inferimos del nombre del modelo
// para marcar bien la opción activa en el menú (el backend ya defaultea a groq).
function inferProvider(model) {
  if (!model) return 'groq'
  if (model.includes('/')) return 'openrouter'
  if (model.includes(':')) return 'ollama'
  if (model.startsWith('claude')) return 'anthropic'
  return 'groq'
}

function ChatComposer({ agent, conversationId, onConversationCreated, onUserSend, onSettled, bare = false }) {
  const { isJunta } = useAuth()
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [voiceGhost, setVoiceGhost] = useState('')
  const [focused, setFocused] = useState(false)
  const taRef = useRef(null)
  const quickPrompts = quickPromptsFor(agent)

  // Selector de modelo (provider + model coherentes). El backend lee de la BD,
  // así que persistimos el cambio en el agente y el siguiente turno lo usa.
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [savingModel, setSavingModel] = useState(false)
  const [modelSel, setModelSel] = useState({
    provider: agent.provider ?? inferProvider(agent.model),
    model: agent.model,
  })
  useEffect(() => {
    setModelSel({ provider: agent.provider ?? inferProvider(agent.model), model: agent.model })
  }, [agent.provider, agent.model])

  const selectModel = async (opt) => {
    setModelMenuOpen(false)
    if (opt.provider === modelSel.provider && opt.model === modelSel.model) return
    const prev = modelSel
    setModelSel({ provider: opt.provider, model: opt.model }) // optimista
    setSavingModel(true)
    const { error } = await supabase
      .from('agents')
      .update({ provider: opt.provider, model: opt.model })
      .eq('slug', agent.slug)
    setSavingModel(false)
    if (error) {
      setModelSel(prev) // revertir si RLS/red falla
      toast.error('No se pudo cambiar el modelo: ' + error.message)
    } else {
      toast.success(`Modelo: ${opt.label}`)
    }
  }

  // Hook de voz — bilingüe ES/EN con 12 capas de NLP (filler removal,
  // comandos por voz, normalización de números, etc).
  const voice = useVoiceTranscription({
    lang: 'es-ES',
    onFinalResult: (voiceText) => {
      setVoiceGhost('')
      setText((prev) => (prev ? `${prev} ${voiceText}`.trim() : voiceText))
      requestAnimationFrame(() => {
        const ta = taRef.current
        if (ta) {
          const len = ta.value.length
          ta.setSelectionRange(len, len)
        }
      })
    },
    onInterimResult: (interim) => setVoiceGhost(interim),
    onError: (msg) => toast.error(msg),
  })

  // Auto-resize del textarea (hasta un cap)
  useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(Math.max(64, ta.scrollHeight), 200) + 'px'
  }, [text, voiceGhost])

  const send = async () => {
    const content = text.trim()
    if (!content || sending) return
    if (agent.status === 'disabled') {
      toast.error('Este agente está deshabilitado. Reactívalo para conversar.')
      return
    }
    if (voice.status !== 'idle') voice.stopListening()
    setSending(true)
    setText('')
    setVoiceGhost('')
    // Pintar el mensaje del usuario al instante (optimistic UI). Si el bot
    // tarda en responder no importa — lo tuyo ya aparece.
    // Si es una conversación NUEVA, generamos su id en el cliente y navegamos al
    // chat de inmediato — así ves tu mensaje y la respuesta EN VIVO (streaming),
    // en vez de esperar en el perfil a que el agente termine todo el turno.
    const isNewConvo = !conversationId
    const targetConvId = conversationId ?? crypto.randomUUID()
    if (isNewConvo) onConversationCreated?.(targetConvId)
    onUserSend?.(content)
    try {
      const { data, error } = await supabase.functions.invoke('chat-with-agent', {
        body: { agent_slug: agent.slug, content, conversation_id: targetConvId },
      })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      // Fallback defensivo: si el backend devolviera OTRO id (no debería: honra el
      // nuestro), lo adoptamos para no perder el hilo.
      if (data?.conversation_id && data.conversation_id !== targetConvId) {
        onConversationCreated?.(data.conversation_id)
      }
    } catch (e) {
      toast.error(e?.message || 'No se pudo enviar')
      setText((prev) => (prev ? prev : content))
    } finally {
      setSending(false)
      onSettled?.()
    }
  }

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const toggleMic = () => {
    if (!voice.isSupported) {
      toast.error('Tu navegador no soporta Web Speech API. Prueba Chrome o Edge.')
      return
    }
    voice.toggle()
  }

  const stub = (msg) => () => toast(msg, { icon: '⏳' })

  const displayedText = voiceGhost
    ? `${text}${text && voiceGhost ? ' ' : ''}${voiceGhost}`
    : text

  // Sugerencias rápidas. En el chat (placement 'top') van arriba, en una sola línea
  // con scroll horizontal. En el perfil del agente ('bottom') van abajo y envuelven.
  const renderPrompts = (placement) => (
    <AnimatePresence>
      {focused && !text.trim() && quickPrompts.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: placement === 'top' ? 4 : -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: placement === 'top' ? 4 : -4 }}
          transition={{ duration: 0.12 }}
          // preventDefault evita que el click haga blur del textarea antes de aplicar
          onMouseDown={(e) => e.preventDefault()}
          className={
            placement === 'top'
              ? 'mb-2 flex flex-nowrap gap-1.5 px-1 overflow-x-auto cursor-grab [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
              : 'mt-2 flex flex-wrap gap-1.5 px-1'
          }
        >
          {quickPrompts.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => {
                setText(p)
                requestAnimationFrame(() => taRef.current?.focus())
              }}
              className={`px-3 py-1.5 rounded-full border border-nina-line bg-nina-line/15 text-[12px] text-nina-mute hover:text-nina-chrome hover:border-nina-silver/40 hover:bg-nina-line/30 transition ${
                placement === 'top' ? 'shrink-0 whitespace-nowrap' : ''
              }`}
            >
              {p}
            </button>
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  )

  return (
    <div
      className={
        bare ? '' : 'px-3 sm:px-4 pt-2 pb-2'
      }
      style={bare ? undefined : { paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom))' }}
    >
      <div className={bare ? '' : 'max-w-3xl mx-auto w-full'}>
      <AnimatePresence>
        {voice.status !== 'idle' && voice.status !== 'unsupported' && (
          <VoiceOverlay voice={voice} />
        )}
      </AnimatePresence>

      {/* En el chat las sugerencias van ARRIBA del composer */}
      {!bare && renderPrompts('top')}

      <div className="rounded-2xl border border-nina-line bg-nina-panel/40 focus-within:border-nina-silver/40 transition-colors">
        <div className="relative px-3 pt-2.5 pb-1">
          <textarea
            ref={taRef}
            value={displayedText}
            onChange={(e) => {
              setText(e.target.value)
              if (voice.status !== 'idle') {
                // Si escribe a mano mientras dicta, paramos el ghost para no
                // duplicar contenido (el final result vendrá vacío).
                setVoiceGhost('')
              }
            }}
            onKeyDown={onKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 150)}
            placeholder={`Escríbele a ${agent.name}…`}
            rows={1}
            className="w-full bg-transparent outline-none resize-none text-sm leading-snug text-nina-chrome placeholder:text-nina-mute"
            style={{ minHeight: '64px', maxHeight: '200px' }}
            disabled={sending}
          />
        </div>

        <div className="flex items-center gap-1 px-2 pb-2">
          {/* Izquierda — attach + settings + agent pill */}
          <button
            type="button"
            onClick={stub('Próximamente: adjuntar archivos')}
            className="w-8 h-8 grid place-items-center rounded-lg text-nina-mute hover:text-nina-chrome hover:bg-nina-line/40 transition"
            title="Adjuntar"
            aria-label="Adjuntar"
          >
            <Paperclip className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={stub('Próximamente: parámetros del turno (temp, tokens)')}
            className="w-8 h-8 grid place-items-center rounded-lg text-nina-mute hover:text-nina-chrome hover:bg-nina-line/40 transition"
            title="Parámetros"
            aria-label="Parámetros"
          >
            <SlidersHorizontal className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={stub('Estás hablando con este agente — cambia desde la lista de la izquierda')}
            className="flex items-center gap-1.5 pl-2 pr-2.5 h-8 rounded-full bg-nina-line/40 hover:bg-nina-line/60 transition text-[11px] font-medium text-nina-chrome"
            title={agent.name}
          >
            <span className="w-4 h-4 rounded-full grid place-items-center bg-silver-gradient text-nina-black shrink-0">
              <Sparkles className="w-2.5 h-2.5" />
            </span>
            <span className="truncate max-w-[120px]">{agent.name}</span>
            <ChevronDown className="w-3 h-3 opacity-60" />
          </button>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Derecha — ⌘K hint + model pill + mic + send */}
          <kbd
            className="hidden sm:flex items-center gap-0.5 px-1.5 h-6 rounded text-[10px] font-mono text-nina-mute bg-nina-line/30 border border-nina-line"
            title="Atajo (próximamente)"
          >
            ⌘K
          </kbd>
          <div className="relative">
            <button
              type="button"
              onClick={() =>
                isJunta
                  ? setModelMenuOpen((o) => !o)
                  : toast(`Modelo: ${modelSel.model}. Solo la Junta puede cambiarlo.`, { icon: '🔒' })
              }
              className="flex items-center gap-1.5 px-2.5 h-8 rounded-full bg-emerald-500/10 hover:bg-emerald-500/15 transition text-[11px] font-mono text-emerald-300"
              title={isJunta ? 'Cambiar modelo del agente' : `Modelo: ${modelSel.model}`}
            >
              {savingModel ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              )}
              <span className="truncate max-w-[120px]">{shortModel(modelSel.model)}</span>
              <ChevronDown className="w-3 h-3 opacity-60" />
            </button>
            <AnimatePresence>
              {modelMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setModelMenuOpen(false)} />
                  <motion.div
                    initial={{ opacity: 0, y: bare ? -6 : 6, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: bare ? -6 : 6, scale: 0.97 }}
                    transition={{ duration: 0.12 }}
                    // En el perfil (bare, composer arriba) el menú baja; en el chat
                    // (composer abajo) sube — así nunca choca con el header.
                    className={`absolute right-0 z-50 w-60 rounded-xl border border-nina-line bg-nina-panel shadow-xl shadow-black/40 p-1 ${
                      bare ? 'top-full mt-2' : 'bottom-full mb-2'
                    }`}
                  >
                    <div className="px-2.5 py-1.5 text-[10px] uppercase tracking-[0.18em] text-nina-mute">
                      Modelo del agente
                    </div>
                    {MODEL_CATALOG.map((opt) => {
                      const active = opt.provider === modelSel.provider && opt.model === modelSel.model
                      return (
                        <button
                          key={opt.provider + opt.model}
                          type="button"
                          onClick={() => selectModel(opt)}
                          className={`w-full text-left px-2.5 py-1.5 rounded-lg transition flex items-start justify-between gap-2 ${
                            active ? 'bg-emerald-500/10' : 'hover:bg-nina-line/40'
                          }`}
                        >
                          <span className="min-w-0">
                            <span
                              className={`block text-[12px] truncate ${
                                active ? 'text-emerald-300' : 'text-nina-chrome'
                              }`}
                            >
                              {opt.label}
                            </span>
                            <span className="block text-[10px] text-nina-mute truncate">{opt.hint}</span>
                          </span>
                          {active && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />}
                        </button>
                      )
                    })}
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
          <button
            type="button"
            onClick={toggleMic}
            disabled={!voice.isSupported}
            className={`w-9 h-9 grid place-items-center rounded-lg transition ${
              voice.status === 'listening'
                ? 'bg-red-500/20 text-red-300 hover:bg-red-500/30'
                : 'text-nina-mute hover:text-nina-chrome hover:bg-nina-line/40'
            } disabled:opacity-40 disabled:cursor-not-allowed`}
            title={
              !voice.isSupported
                ? 'Voz no soportada en este navegador'
                : voice.status === 'listening'
                ? 'Detener dictado'
                : 'Dictar por voz'
            }
            aria-label="Micrófono"
          >
            {voice.isSupported ? (
              voice.status === 'listening' ? (
                <Mic className="w-4 h-4" />
              ) : (
                <Mic className="w-4 h-4" />
              )
            ) : (
              <MicOff className="w-4 h-4" />
            )}
          </button>
          <button
            type="button"
            onClick={send}
            disabled={!text.trim() || sending}
            className="btn-primary !p-2 h-9 w-9 grid place-items-center"
            title="Enviar (Enter)"
            aria-label="Enviar"
          >
            {sending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <ArrowUp className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>

      {/* En el perfil del agente las sugerencias van ABAJO del composer */}
      {bare && renderPrompts('bottom')}
      </div>
    </div>
  )
}

// Recorta nombres largos de modelo para que quepan en la pill (~14 chars)
function shortModel(model) {
  if (!model) return 'modelo'
  if (model.length <= 16) return model
  // llama-3.3-70b-versatile → llama-3.3-70b
  const parts = model.split('-')
  if (parts.length > 3) return parts.slice(0, 3).join('-')
  return model.slice(0, 14) + '…'
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
// Tab · Conectores (servicios externos según las tools del agente)
// =====================================================================
const CONNECTOR_CATALOG = [
  {
    id: 'shopify',
    name: 'Tienda Shopify',
    desc: 'Productos, inventario, órdenes y clientes de la tienda.',
    icon: ShoppingBag,
    iconColor: 'text-emerald-300',
    tools: [
      'shopify_search_products',
      'shopify_recent_orders',
      'shopify_search_customers',
      'shopify_get_inventory',
      'shopify_adjust_inventory',
      'shopify_shop_summary',
    ],
  },
  {
    id: 'brain',
    name: 'Brain · base de conocimiento',
    desc: 'Memoria institucional semántica de la marca.',
    icon: Database,
    iconColor: 'text-sky-300',
    tools: ['query_brain', 'ingest_document'],
  },
  {
    id: 'web',
    name: 'Búsqueda web (Tavily)',
    desc: 'Investigación en internet en tiempo real.',
    icon: Globe,
    iconColor: 'text-amber-300',
    tools: ['web_search'],
  },
  {
    id: 'image',
    name: 'Generación de imágenes',
    desc: 'Crea imágenes con IA (Higgsfield / Pollinations).',
    icon: ImageIcon,
    iconColor: 'text-purple-300',
    tools: ['generate_image'],
  },
]

// Conectores que aún no están implementados (estilo "próximamente").
const CONNECTOR_SOON = [
  { id: 'meta', name: 'Meta Ads Manager', desc: 'Campañas y métricas de Meta.' },
  { id: 'instagram', name: 'Instagram', desc: 'Publicaciones, historias y mensajes.' },
]

function ConnectorRow({ icon: Icon, iconColor, name, desc, status, onConnect }) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-xl border border-nina-line bg-nina-panel/40">
      <div className="w-9 h-9 rounded-lg grid place-items-center bg-nina-line/40 shrink-0">
        <Icon className={`w-4 h-4 ${iconColor ?? 'text-nina-chrome'}`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-nina-chrome truncate">{name}</div>
        <div className="text-[11px] text-nina-mute truncate">{desc}</div>
      </div>
      {status === 'connected' ? (
        <span className="text-[11px] text-emerald-300 flex items-center gap-1 shrink-0">
          <CheckCircle2 className="w-3.5 h-3.5" /> Conectado
        </span>
      ) : (
        <button
          onClick={onConnect}
          className="btn-ghost !py-1.5 !px-3 text-[11px] shrink-0"
          title="Conectar"
        >
          Conectar
        </button>
      )}
    </div>
  )
}

function ConnectorsTab({ agentId, agentBasic }) {
  const { agent: detail, loading } = useAgentDetail(agentId)
  const [brandName, setBrandName] = useState(null)

  useEffect(() => {
    if (!detail?.brand_id) {
      setBrandName(null)
      return
    }
    let active = true
    supabase
      .from('brands')
      .select('name')
      .eq('id', detail.brand_id)
      .maybeSingle()
      .then(({ data }) => active && setBrandName(data?.name ?? null))
    return () => {
      active = false
    }
  }, [detail?.brand_id])

  if (loading) {
    return (
      <div className="h-full grid place-items-center text-nina-mute">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    )
  }
  if (!detail) return null

  const tools = detail.allowed_tools ?? []
  const connected = CONNECTOR_CATALOG.filter((c) => c.tools.some((t) => tools.includes(t)))

  return (
    <div className="h-full overflow-y-auto px-4 sm:px-6 py-4 space-y-5 max-w-2xl">
      <header>
        <h3 className="text-xs uppercase tracking-[0.2em] text-nina-mute">Conectores</h3>
        <p className="text-[12px] text-nina-mute mt-1">
          Servicios externos a los que {agentBasic.name} tiene acceso a través de sus herramientas.
        </p>
      </header>

      <section className="space-y-2">
        <div className="text-[10px] uppercase tracking-[0.2em] text-nina-mute">Conectados</div>
        {connected.length === 0 ? (
          <div className="text-[13px] text-nina-mute py-2">
            Este agente no tiene conectores externos activos. Actívalos asignándole las tools correspondientes en la pestaña Tools.
          </div>
        ) : (
          connected.map((c) => (
            <ConnectorRow
              key={c.id}
              icon={c.icon}
              iconColor={c.iconColor}
              name={c.id === 'shopify' && brandName ? `Tienda ${brandName} (Shopify)` : c.name}
              desc={c.desc}
              status="connected"
            />
          ))
        )}
      </section>

      <section className="space-y-2">
        <div className="text-[10px] uppercase tracking-[0.2em] text-nina-mute">
          Disponibles próximamente
        </div>
        {CONNECTOR_SOON.map((c) => (
          <ConnectorRow
            key={c.id}
            icon={Plug}
            iconColor="text-nina-mute"
            name={c.name}
            desc={c.desc}
            status="soon"
            onConnect={() => toast(`${c.name}: integración próximamente`, { icon: '🔌' })}
          />
        ))}
      </section>
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
// Etiquetas humanas para los nombres técnicos de las tools.
const TOOL_LABELS = {
  search_memory: 'Buscó en su memoria',
  save_memory: 'Guardó en memoria',
  query_brain: 'Consultó el brain',
  ingest_document: 'Ingestó un documento',
  delegate_task: 'Delegó una tarea',
  request_approval: 'Pidió aprobación a la Junta',
  finish_task: 'Finalizó la tarea',
  escalate_to_ceo: 'Escaló al CEO',
  read_kpis: 'Consultó los KPIs',
  web_search: 'Buscó en la web',
  generate_image: 'Generó una imagen',
  create_agent: 'Solicitó crear un agente',
  shopify_search_products: 'Buscó productos',
  shopify_recent_orders: 'Consultó órdenes',
  shopify_search_customers: 'Buscó clientes',
  shopify_get_inventory: 'Consultó inventario',
  shopify_adjust_inventory: 'Ajustó inventario',
  shopify_shop_summary: 'Resumen de la tienda',
}
const humanTool = (name) => TOOL_LABELS[name] || name

// Agrupa la actividad de tools (llamadas + resultados) consecutiva en UN panel
// colapsable estilo Runable: una sola línea "N pasos ▸" que se despliega al hacer
// click, en vez de muchas líneas sueltas (antes el chip de llamada y la burbuja de
// resultado salían por separado → se veía duplicado y disperso). El texto del agente
// y del usuario sigue como burbuja normal.
function groupTimeline(messages) {
  const items = []
  let buf = []
  const flush = () => {
    if (buf.length) {
      items.push({ kind: 'steps', steps: buildSteps(buf), key: `steps-${buf[0].key}` })
      buf = []
    }
  }
  for (const m of messages) {
    if (m.role === 'system') continue
    // Nota de sistema (p.ej. el auto-resume de aprobación). Aunque se persiste como
    // role:'user' (para que el agente la procese), la pintamos como chip centrado y NO
    // como burbuja del usuario: la decisión la tomó la Junta en el panel, no este chat.
    if (m.metadata?.source === 'approval_resume') {
      flush()
      items.push({ kind: 'note', message: m, key: m.id })
      continue
    }
    if (m.role === 'tool') {
      buf.push({ kind: 'result', message: m, key: m.id })
      continue
    }
    const hasContent = !!(m.content && String(m.content).trim())
    const hasTools = Array.isArray(m.tool_calls) && m.tool_calls.length > 0
    if (m.role === 'assistant') {
      if (hasContent) {
        flush()
        items.push({ kind: 'message', message: m, key: m.id })
      }
      if (hasTools) for (const tc of m.tool_calls) buf.push({ kind: 'call', call: tc, key: tc.id || m.id })
      continue
    }
    // user (o cualquier otro con texto)
    flush()
    items.push({ kind: 'message', message: m, key: m.id })
  }
  flush()
  return items
}

// Empareja cada resultado con su llamada (por tool_call_id) → un "paso" por acción.
function buildSteps(buf) {
  const steps = []
  const byCallId = new Map()
  for (const it of buf) {
    if (it.kind === 'call') {
      const step = { call: it.call, result: null }
      steps.push(step)
      if (it.call?.id) byCallId.set(it.call.id, step)
    } else {
      const cid = it.message.tool_call_id
      const owner = cid ? byCallId.get(cid) : null
      if (owner && !owner.result) owner.result = it.message
      else steps.push({ call: null, result: it.message })
    }
  }
  return steps
}

function StepsGroup({ steps }) {
  const [open, setOpen] = useState(false)
  const n = steps.length
  const lastCall = [...steps].reverse().find((s) => s.call)?.call
  const lastLabel = lastCall ? humanTool(lastCall.function.name) : 'resultado'
  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="flex justify-start">
      <div className="w-full max-w-[90%] sm:max-w-[80%]">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1.5 py-0.5 text-[11.5px] text-nina-mute hover:text-nina-chrome transition select-none"
        >
          <ListTodo className="w-3.5 h-3.5 opacity-70 shrink-0" />
          <span className="font-medium">
            {n} paso{n === 1 ? '' : 's'}
          </span>
          {!open && <span className="opacity-60 truncate max-w-[220px]">· {lastLabel}</span>}
          <ChevronRight className={`w-3 h-3 opacity-50 transition ${open ? 'rotate-90' : ''}`} />
        </button>
        {open && (
          <div className="mt-1 ml-1.5 border-l border-nina-line/50 pl-3 space-y-1">
            {steps.map((s, i) => (
              <StepRow key={i} step={s} />
            ))}
          </div>
        )}
      </div>
    </motion.div>
  )
}

// Un paso = una acción. Si ya tiene resultado, mostramos la burbuja de resultado
// (colapsable, con su detalle); si sigue corriendo, el chip de la llamada.
function StepRow({ step }) {
  if (step.result) return <ToolResultBubble message={step.result} />
  if (step.call) return <ToolCallChip call={step.call} />
  return null
}

// Nota de sistema centrada (no atribuible al usuario ni al agente). P.ej. el aviso de
// que la Junta aprobó una solicitud desde el panel de Aprobaciones.
function SystemNote({ message }) {
  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="flex justify-center">
      <div className="text-[11px] text-nina-mute bg-nina-line/30 border border-nina-line/40 rounded-full px-3 py-1 max-w-[85%] text-center break-words">
        {message.content}
      </div>
    </motion.div>
  )
}

function MessageBubble({ message, hideTools = false }) {
  const { role, content, tool_calls, created_at } = message

  if (role === 'system') return null
  if (role === 'tool') return <ToolResultBubble message={message} />

  const isUser = role === 'user'
  const hasTools = Array.isArray(tool_calls) && tool_calls.length > 0

  // Asistente que SOLO ejecuta tools (sin texto) → líneas sutiles, sin burbuja
  if (!isUser && !content && hasTools) {
    if (hideTools) return null // en el timeline agrupado los pinta StepsGroup
    return (
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex justify-start"
      >
        <div className="space-y-0.5 pl-1">
          {tool_calls.map((tc) => (
            <ToolCallChip key={tc.id} call={tc} />
          ))}
        </div>
      </motion.div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
    >
      <div className="max-w-[85%] sm:max-w-[75%] space-y-1.5">
        {content && (
          <div
            className={`rounded-2xl px-4 py-2.5 ${
              isUser
                ? 'bg-silver-gradient text-nina-black rounded-br-md shadow-chrome'
                : 'bg-nina-line/60 text-nina-chrome rounded-bl-md border border-nina-line'
            }`}
          >
            {isUser ? (
              <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">{content}</div>
            ) : (
              <Markdown className="text-sm leading-relaxed">{content}</Markdown>
            )}
          </div>
        )}
        {!hideTools && hasTools && (
          <div className="space-y-0.5 pl-1">
            {tool_calls.map((tc) => (
              <ToolCallChip key={tc.id} call={tc} />
            ))}
          </div>
        )}
        <div className={`text-[10px] text-nina-mute ${isUser ? 'text-right' : 'pl-1'}`}>
          {fmtTime(created_at)}
        </div>
      </div>
    </motion.div>
  )
}

// Línea sutil de una llamada a tool (estilo Manus): icono + acción humana.
function ToolCallChip({ call }) {
  let arg = ''
  try {
    const args = JSON.parse(call?.function?.arguments || '{}')
    arg = args.query || args.title || args.summary || args.content || ''
  } catch {
    arg = ''
  }
  return (
    <div className="flex items-center gap-1.5 text-[11.5px] text-nina-mute">
      <Hammer className="w-3 h-3 shrink-0 opacity-60" />
      <span>{humanTool(call.function.name)}</span>
      {arg && (
        <span className="opacity-60 truncate max-w-[260px]">· {String(arg).slice(0, 48)}</span>
      )}
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
