import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowLeft,
  ArrowUp,
  BookOpen,
  Bot,
  Calculator,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
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
  Save,
  Settings as SettingsIcon,
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
  Thermometer,
  Trash2,
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
  creador_contenido: Clapperboard,
  contador: Calculator,
  inventarista: Package,
}

function agentIcon(agent) {
  if (!agent) return Bot
  if (agent.role === 'ceo_global') return Crown
  // La ESPECIALIDAD manda sobre el genérico del rol (antes brand_manager → Sparkles
  // y Contador/Inventarista salían iguales). Mismo criterio que el sidebar.
  const bySpecialty = agent.specialty && SPECIALTY_ICON[agent.specialty]
  if (bySpecialty) return bySpecialty
  const k = `${agent.name ?? ''} ${agent.specialty ?? ''}`.toLowerCase()
  if (/venta|sales|\bcrm\b|kpi|report/.test(k)) return TrendingUp
  if (/contad|finan|conta\b/.test(k)) return Calculator
  if (/content|conteni|market|campañ|redact/.test(k)) return Clapperboard
  if (/inventar|stock|bodega/.test(k)) return Package
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
  // Avances eliminados del canvas (optimista). El soft-hide persistente vive en
  // metadata.canvas_hidden (lo marca la Edge Function canvas-hide-artifact).
  const [hiddenKeys, setHiddenKeys] = useState(() => new Set())

  // TODOS los artefactos de email del hilo (cada compose_email), en orden cronológico.
  // Cada uno es una PESTAÑA del canvas → al crear uno nuevo NO se pierde el anterior.
  // Excluimos los ocultados (soft-hide persistente o eliminación optimista en curso).
  const canvasArtifacts = useMemo(() => {
    const out = []
    for (const m of messages) {
      if (m.role !== 'tool' || typeof m.content !== 'string') continue
      if (m.metadata?.canvas_hidden || hiddenKeys.has(m.id)) continue
      try {
        const p = JSON.parse(m.content)
        if (!p?.ok || !p.data) continue
        const d = p.data
        if (d.kind === 'email' && d.html) {
          // Correo HTML (compose_email) → iframe.
          out.push({ type: 'email', subject: d.subject ?? '(sin asunto)', html: String(d.html), messageId: m.id, key: String(m.id) })
        } else if (Array.isArray(d.images) && d.images.length) {
          // Imágenes generadas (generate_image) → una pestaña por imagen.
          d.images.forEach((img, i) => {
            const url = typeof img === 'string' ? img : img?.url
            if (url) {
              out.push({
                type: 'image',
                title: d.prompt ? String(d.prompt).slice(0, 48) : 'Imagen',
                url: String(url),
                aspect: d.aspect_ratio ?? null,
                messageId: m.id,
                key: `${m.id}:${i}`,
              })
            }
          })
        } else if (d.kind === 'calendar') {
          // Agenda del calendario (calendar_create_event / calendar_list_events).
          out.push({ type: 'calendar', title: 'Calendario', events: Array.isArray(d.events) ? d.events : [], messageId: m.id, key: String(m.id) })
        }
      } catch {
        /* no es JSON / no es artefacto */
      }
    }
    return out
  }, [messages, hiddenKeys])
  const latestArtifact = canvasArtifacts.length ? canvasArtifacts[canvasArtifacts.length - 1] : null

  const [canvasOpen, setCanvasOpen] = useState(false)
  const [activeKey, setActiveKey] = useState(null)
  const activeArtifact = canvasArtifacts.find((a) => a.key === activeKey) ?? latestArtifact

  // Auto-abrimos el canvas y activamos la pestaña SOLO cuando el agente genera un email
  // NUEVO en vivo (las anteriores quedan como íconos). Entrar/volver a un hilo que ya traía
  // emails NO fuerza el avance (para eso está "Avance") — no "secuestra" la vista.
  const initialArtifactKey = useRef(undefined)
  useEffect(() => {
    if (initialArtifactKey.current === undefined && messages.length > 0) {
      initialArtifactKey.current = latestArtifact?.key ?? null
    }
    if (
      initialArtifactKey.current !== undefined &&
      latestArtifact &&
      latestArtifact.key !== initialArtifactKey.current
    ) {
      setCanvasOpen(true)
      setActiveKey(latestArtifact.key) // nueva pestaña al frente; las previas quedan como íconos
    }
  }, [latestArtifact?.key, messages.length])

  // Guardar el artefacto activo en la Biblioteca (entregable). Cliente → library_assets
  // (la policy RLS valida acceso de marca). Marcamos el key como guardado para el check.
  const [savedKeys, setSavedKeys] = useState(() => new Set())
  const saveToLibrary = async (artifact) => {
    if (!artifact) return
    const t = toast.loading('Guardando en la biblioteca…')
    try {
      let row
      if (artifact.type === 'image') {
        row = { title: artifact.title || 'Imagen NINA', kind: 'image', url: artifact.url, source: 'canvas', size_bytes: 0, agent_id: agent.id, brand_id: agent.brand_id ?? null }
      } else if (artifact.type === 'calendar') {
        const text = (artifact.events || []).map((e) => `${e.start ?? ''} — ${e.title ?? ''}`).join('\n') || 'Sin eventos'
        row = { title: 'Agenda de calendario', kind: 'other', content: text, source: 'canvas', size_bytes: new Blob([text]).size, agent_id: agent.id, brand_id: agent.brand_id ?? null }
      } else {
        row = { title: artifact.subject || 'Correo NINA', kind: 'campaign', content: artifact.html, source: 'canvas', size_bytes: new Blob([artifact.html]).size, agent_id: agent.id, brand_id: agent.brand_id ?? null }
      }
      const { error } = await supabase.from('library_assets').insert(row)
      if (error) throw error
      setSavedKeys((s) => new Set(s).add(artifact.key))
      toast.success('Guardado en la biblioteca', { id: t })
    } catch (e) {
      toast.error(e?.message || 'No se pudo guardar', { id: t })
    }
  }

  // Eliminar el avance del canvas (soft-hide persistente vía Edge Function). Optimista:
  // lo ocultamos ya; si falla, lo restauramos. Si era el activo, vuelve al más reciente.
  const deleteArtifact = async (artifact) => {
    if (!artifact) return
    // Ocultamos por messageId (las imágenes son varias por mensaje; hiddenKeys guarda ids
    // de mensaje, igual que el filtro del useMemo). Soft-hide persistente vía Edge Function.
    setHiddenKeys((s) => new Set(s).add(artifact.messageId))
    if (activeKey === artifact.key) setActiveKey(null)
    const { data, error } = await supabase.functions.invoke('canvas-hide-artifact', {
      body: { message_id: artifact.messageId },
    })
    if (error || data?.error) {
      setHiddenKeys((s) => {
        const n = new Set(s)
        n.delete(artifact.messageId)
        return n
      })
      toast.error('No se pudo eliminar el avance')
    } else {
      toast.success('Avance eliminado del canvas')
    }
  }

  // ── Preguntas aclaratorias (ask_questions) ───────────────────────────────
  // Detecta el ÚLTIMO set de preguntas SIN responder del hilo (el agente cerró su turno
  // tras preguntar). "Respondido" = hay un mensaje del usuario después del artefacto, o
  // acabamos de enviar (answeredKey, optimista).
  const [answeredKey, setAnsweredKey] = useState(null)
  const activeQuestions = useMemo(() => {
    let found = null
    let idx = -1
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i]
      if (m.role !== 'tool' || typeof m.content !== 'string') continue
      try {
        const p = JSON.parse(m.content)
        if (p?.ok && p?.data?.kind === 'questions' && Array.isArray(p.data.questions) && p.data.questions.length) {
          found = { key: m.id, questions: p.data.questions }
          idx = i
        }
      } catch {
        /* no es JSON */
      }
    }
    if (!found || found.key === answeredKey) return null
    for (let i = idx + 1; i < messages.length; i++) if (messages[i].role === 'user') return null
    return found
  }, [messages, answeredKey])

  // Respuestas rápidas CONTEXTUALES: tras cada turno cerrado pedimos al backend 3
  // seguimientos según cómo va la conversación. Si no hay (chat nuevo / falla), el
  // composer cae a las estáticas por rol.
  const [suggestions, setSuggestions] = useState([])
  useEffect(() => {
    setSuggestions([]) // limpiar al cambiar de hilo
  }, [conversationId])
  useEffect(() => {
    if (!conversationId || thinking) return
    const last = messages[messages.length - 1]
    if (!last || last.role !== 'assistant' || !last.content) return
    let active = true
    supabase.functions
      .invoke('suggest-followups', { body: { agent_slug: agent.slug, conversation_id: conversationId } })
      .then(({ data, error }) => {
        if (active && !error && Array.isArray(data?.suggestions) && data.suggestions.length) {
          setSuggestions(data.suggestions)
        }
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [conversationId, messages.length, thinking, agent.slug])

  // Envía las respuestas del formulario como el siguiente mensaje del usuario; el agente
  // continúa con ellas. Mismo camino que el composer (optimista + chat-with-agent).
  const submitAnswers = async (text) => {
    const prevAnswered = answeredKey
    const optId = `opt-q-${Date.now()}`
    if (activeQuestions) setAnsweredKey(activeQuestions.key) // oculta el form al instante
    setOptimistic((prev) => [
      ...prev,
      { id: optId, role: 'user', content: text, created_at: new Date().toISOString(), optimistic: true },
    ])
    setThinking(true)
    try {
      const { data, error } = await supabase.functions.invoke('chat-with-agent', {
        body: { agent_slug: agent.slug, content: text, conversation_id: conversationId },
      })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
    } catch (e) {
      // Revertir: restaura el formulario y quita el mensaje fantasma para reintentar.
      setAnsweredKey(prevAnswered)
      setOptimistic((prev) => prev.filter((m) => m.id !== optId))
      toast.error(e?.message || 'No se pudo enviar')
    } finally {
      setThinking(false)
    }
  }

  // Marcamos ?canvas=1 en la URL cuando el canvas está abierto → el layout oculta el
  // sidebar y le da más espacio. Al cerrar el canvas (canvasOpen=false) este mismo efecto
  // lo quita; al SALIR del chat lo quita goHome (borra c+canvas atómicamente).
  //
  // OJO: NO añadir un efecto de limpieza con deps [] que haga setSearchParams al
  // desmontar. react-router memoiza setSearchParams por `searchParams`, y la versión
  // capturada en el montaje cierra sobre la URL de ENTONCES (?c=<id>). Al desmontar
  // (tras goHome) ese setter reaplica esa URL vieja y RESUCITA ?c → el chat se recarga
  // en vez de volver al perfil. (Bug real ya corregido — no reintroducir.)
  const [, setSearchParams] = useSearchParams()
  const hasArtifact = canvasArtifacts.length > 0
  useEffect(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (canvasOpen && hasArtifact) next.set('canvas', '1')
      else next.delete('canvas')
      return next
    }, { replace: true })
  }, [canvasOpen, hasArtifact])

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
          {canvasArtifacts.length > 0 && (
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
          {activeQuestions && (
            <QuestionsForm
              key={activeQuestions.key}
              questions={activeQuestions.questions}
              onSubmit={submitAnswers}
              onDismiss={() => setAnsweredKey(activeQuestions.key)}
            />
          )}
        </div>
      </div>
      <ChatComposer
        agent={agent}
        conversationId={conversationId}
        onConversationCreated={onConversationCreated}
        onUserSend={addOptimistic}
        onSettled={() => setThinking(false)}
        suggestions={suggestions}
      />
      </div>
      <AnimatePresence>
        {canvasOpen && canvasArtifacts.length > 0 && (
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
            <ArtifactCanvas
              artifacts={canvasArtifacts}
              active={activeArtifact}
              onSelect={setActiveKey}
              onClose={() => setCanvasOpen(false)}
              onSave={() => saveToLibrary(activeArtifact)}
              onDelete={() => deleteArtifact(activeArtifact)}
              saved={activeArtifact ? savedKeys.has(activeArtifact.key) : false}
            />
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  )
}

// Canvas (F3) — split-view tipo NeuralOS. Hoy renderiza el preview en vivo del
// correo HTML (artefacto de compose_email); luego se le suman pestañas (browser, docs).
// Agenda visual del calendario de marca (próximos eventos del artefacto kind:'calendar').
function CalendarView({ events }) {
  const list = Array.isArray(events) ? events : []
  if (list.length === 0) {
    return (
      <div className="h-full grid place-items-center text-nina-mute text-sm text-center px-6">
        No hay eventos próximos en el calendario.
      </div>
    )
  }
  const fmt = (s) => {
    if (!s) return { day: '', time: '' }
    const allDay = /^\d{4}-\d{2}-\d{2}$/.test(s)
    const d = new Date(allDay ? `${s}T12:00:00` : s)
    if (isNaN(d.getTime())) return { day: String(s), time: '' }
    return {
      day: d.toLocaleDateString('es-CO', { weekday: 'short', day: '2-digit', month: 'short' }),
      time: allDay ? 'Todo el día' : d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }),
    }
  }
  return (
    <div className="h-full overflow-y-auto rounded-lg border border-nina-line bg-nina-panel/30 p-3 space-y-2">
      <div className="text-[11px] uppercase tracking-[0.2em] text-nina-mute px-1 pb-1">Próximos eventos</div>
      {list.map((e, i) => {
        const f = fmt(e.start)
        return (
          <div key={e.id || i} className="flex items-stretch gap-3 rounded-xl border border-nina-line/50 bg-nina-line/15 px-3 py-2.5">
            <div className="w-1 rounded-full bg-silver-gradient shrink-0" />
            <div className="w-16 shrink-0">
              <div className="text-[10px] uppercase tracking-wide text-nina-mute">{f.day}</div>
              <div className="text-[11px] text-nina-chrome mt-0.5">{f.time}</div>
            </div>
            <div className="flex-1 min-w-0 self-center">
              <div className="text-[13.5px] text-nina-chrome leading-snug break-words">{e.title}</div>
              {e.html_link && (
                <a
                  href={e.html_link}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[10px] text-nina-mute hover:text-nina-chrome underline underline-offset-2"
                >
                  ver en Google Calendar ↗
                </a>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ArtifactCanvas({ artifacts, active, onSelect, onClose, onSave, onDelete, saved }) {
  const label = (a) => (a.type === 'calendar' ? 'Calendario' : a.type === 'image' ? a.title : a.subject)
  return (
    <div className="flex flex-col min-w-0 w-full h-full">
      {/* Barra de pestañas estilo Chrome: la activa muestra el título; las demás colapsan
          a solo el ícono (clic para traerlas al frente). Maneja correos e imágenes. */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-nina-line/60 shrink-0">
        <div className="flex items-center gap-1 min-w-0 overflow-x-auto">
          {artifacts.map((a) => {
            const isActive = active && a.key === active.key
            const TabIcon = a.type === 'image' ? ImageIcon : a.type === 'calendar' ? CalendarDays : MessageSquare
            return (
              <button
                key={a.key}
                onClick={() => onSelect(a.key)}
                title={label(a)}
                className={`flex items-center gap-2 h-8 rounded-lg text-[12px] transition shrink-0 ${
                  isActive
                    ? 'bg-nina-line/40 text-nina-chrome pl-2 pr-3 max-w-[220px]'
                    : 'w-8 justify-center bg-nina-line/20 text-nina-mute hover:text-nina-chrome hover:bg-nina-line/30'
                }`}
              >
                <span className="w-4 h-4 rounded grid place-items-center bg-silver-gradient text-nina-black shrink-0">
                  <TabIcon className="w-2.5 h-2.5" />
                </span>
                {isActive && <span className="truncate">{label(a)}</span>}
              </button>
            )
          })}
        </div>
        <div className="flex-1" />
        <button
          onClick={onSave}
          disabled={saved}
          className={`h-8 px-2.5 rounded-lg text-[11px] flex items-center gap-1.5 transition shrink-0 ${
            saved
              ? 'text-emerald-300 cursor-default'
              : 'text-nina-mute hover:text-nina-chrome hover:bg-nina-line/40'
          }`}
          title={saved ? 'Ya está en la biblioteca' : 'Guardar en la biblioteca'}
        >
          {saved ? <CheckCircle2 className="w-4 h-4" /> : <Save className="w-4 h-4" />}
          <span className="hidden lg:inline">{saved ? 'Guardado' : 'Guardar'}</span>
        </button>
        <button
          onClick={onDelete}
          className="h-8 px-2.5 rounded-lg text-[11px] flex items-center gap-1.5 text-nina-mute hover:text-red-300 hover:bg-red-500/10 transition shrink-0"
          title="Eliminar este avance del canvas"
        >
          <Trash2 className="w-4 h-4" />
          <span className="hidden lg:inline">Eliminar</span>
        </button>
        <button
          onClick={onClose}
          className="w-7 h-7 grid place-items-center rounded-lg text-nina-mute hover:text-nina-chrome hover:bg-nina-line/40 transition shrink-0"
          title="Cerrar canvas"
          aria-label="Cerrar canvas"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      {/* Preview del artefacto activo: agenda de calendario, imagen (<img>) o correo HTML (iframe). */}
      <div className="flex-1 min-h-0 bg-nina-ink p-3">
        {active?.type === 'calendar' ? (
          <CalendarView events={active.events} />
        ) : active?.type === 'image' ? (
          <div className="w-full h-full grid place-items-center overflow-auto">
            <img
              src={active.url}
              alt={active.title}
              referrerPolicy="no-referrer"
              className="max-w-full max-h-full rounded-lg border border-nina-line object-contain"
            />
          </div>
        ) : (
          <iframe
            title="Preview del correo NINA"
            srcDoc={active?.html ?? ''}
            sandbox=""
            className="w-full h-full rounded-lg bg-white border border-nina-line"
          />
        )}
      </div>
      <div className="px-3 py-2 border-t border-nina-line/60 text-[11px] text-nina-mute shrink-0">
        {active?.type === 'calendar' ? (
          <>Agenda del calendario de marca · pídele al agente que agende o liste más eventos.</>
        ) : active?.type === 'image' ? (
          <>Imagen generada{active.aspect ? ` · ${active.aspect}` : ''} · guárdala en la biblioteca o pídele al agente que la ajuste.</>
        ) : (
          <>
            Vista previa en vivo · cuando esté lista, pídele al agente que la envíe con{' '}
            <span className="text-nina-chrome">send_email</span>.
          </>
        )}
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

function ChatComposer({ agent, conversationId, onConversationCreated, onUserSend, onSettled, bare = false, suggestions }) {
  const { isJunta } = useAuth()
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [voiceGhost, setVoiceGhost] = useState('')
  const [focused, setFocused] = useState(false)
  const taRef = useRef(null)
  // Respuestas rápidas: si hay sugerencias CONTEXTUALES (según la conversación), úsalas;
  // si no (chat nuevo / home), cae a las estáticas por rol.
  const quickPrompts = suggestions?.length ? suggestions : quickPromptsFor(agent)

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
    // Nota de sistema (p.ej. el auto-resume de aprobación, o el disparador del reporte
    // diario de ventas). Aunque se persiste como role:'user' (para que el agente la
    // procese), la pintamos como chip centrado y NO como burbuja del usuario: la generó
    // el sistema (la Junta o el cron), no este chat.
    if (m.metadata?.source === 'approval_resume' || m.metadata?.source === 'scheduled_report') {
      flush()
      items.push({ kind: 'note', message: m, key: m.id })
      continue
    }
    if (m.role === 'tool') {
      // Las preguntas aclaratorias se muestran como formulario aparte, NO como "paso".
      try {
        const p = typeof m.content === 'string' ? JSON.parse(m.content) : null
        if (p?.data?.kind === 'questions') continue
      } catch {
        /* no es JSON */
      }
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
      // El key incluye el id del MENSAJE (único) porque tc.id NO es único entre turnos:
      // el proveedor reutiliza ids tipo "functions.request_approval:13" → keys duplicadas.
      if (hasTools) m.tool_calls.forEach((tc, ti) => buf.push({ kind: 'call', call: tc, key: `${m.id}:${tc.id || ti}` }))
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

// Formulario de preguntas aclaratorias (estilo AskUserQuestion). Por pasos: text /
// single / multi, con un campo "Otro" libre al final. Al terminar arma un solo mensaje
// "pregunta: respuesta" y lo envía. La X omite el formulario (el usuario escribe libre).
function QuestionsForm({ questions, onSubmit, onDismiss }) {
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState({}) // i -> string (text/single) | string[] (multi)
  const [other, setOther] = useState({}) // i -> texto libre "Otro"
  const total = questions.length
  const q = questions[step]
  const isLast = step === total - 1

  const setText = (i, v) => setAnswers((a) => ({ ...a, [i]: v }))
  const toggleMulti = (i, opt) =>
    setAnswers((a) => {
      const cur = Array.isArray(a[i]) ? a[i] : []
      return { ...a, [i]: cur.includes(opt) ? cur.filter((x) => x !== opt) : [...cur, opt] }
    })

  const finish = () => {
    const lines = []
    questions.forEach((qq, i) => {
      const o = (other[i] ?? '').trim()
      let ans = ''
      if (qq.type === 'multi') {
        const arr = Array.isArray(answers[i]) ? [...answers[i]] : []
        if (o) arr.push(o)
        ans = arr.join(', ')
      } else {
        ans = (typeof answers[i] === 'string' ? answers[i] : '').trim() || o
      }
      if (ans) lines.push(`${qq.prompt}: ${ans}`)
    })
    onSubmit(lines.length ? lines.join('\n\n') : 'Usa tu mejor criterio para los detalles.')
  }

  const next = () => (isLast ? finish() : setStep((s) => Math.min(s + 1, total - 1)))
  const prev = () => setStep((s) => Math.max(s - 1, 0))

  const hasOptions = (q.type === 'single' || q.type === 'multi') && (q.options ?? []).length > 0

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-nina-line bg-nina-panel/80 backdrop-blur px-4 py-3.5 shadow-chrome max-w-2xl mx-auto w-full"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-[11px] text-nina-mute">Pregunta {step + 1} de {total}</div>
        <button
          onClick={onDismiss}
          title="Omitir y escribir libremente"
          className="text-nina-mute hover:text-nina-chrome transition shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="text-[15px] text-nina-chrome font-medium leading-snug mt-1">{q.prompt}</div>
      <div className="text-[11px] text-nina-mute mb-3">
        {q.type === 'text' || !hasOptions
          ? 'Escribe tu respuesta'
          : q.type === 'multi'
            ? 'Elige una o varias, o escribe abajo'
            : 'Elige una o escribe abajo'}
      </div>

      {hasOptions && (
        <div className="space-y-1.5 mb-2">
          {q.options.map((opt, oi) => {
            const selected =
              q.type === 'multi' ? Array.isArray(answers[step]) && answers[step].includes(opt) : answers[step] === opt
            return (
              <button
                key={oi}
                type="button"
                onClick={() => (q.type === 'multi' ? toggleMulti(step, opt) : setText(step, selected ? '' : opt))}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-[13.5px] transition border ${
                  selected
                    ? 'border-nina-silver/50 bg-nina-line/50 text-nina-chrome'
                    : 'border-nina-line/50 bg-nina-line/20 text-nina-mute hover:text-nina-chrome hover:border-nina-line'
                }`}
              >
                <span
                  className={`w-5 h-5 rounded grid place-items-center text-[11px] shrink-0 ${
                    selected ? 'bg-silver-gradient text-nina-black' : 'bg-nina-line/60 text-nina-mute'
                  }`}
                >
                  {q.type === 'multi' ? (selected ? '✓' : '') : oi + 1}
                </span>
                <span className="flex-1">{opt}</span>
              </button>
            )
          })}
        </div>
      )}

      <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-nina-line/50 bg-nina-ink/40">
        <Pencil className="w-3.5 h-3.5 text-nina-mute shrink-0" />
        <input
          value={q.type === 'text' ? answers[step] ?? '' : other[step] ?? ''}
          onChange={(e) =>
            q.type === 'text' ? setText(step, e.target.value) : setOther((o) => ({ ...o, [step]: e.target.value }))
          }
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            // En 'text' Enter avanza/envía; en el campo "Otro" de single/multi NO envía en
            // el último paso (evita el envío prematuro mientras se escribe).
            if (q.type === 'text' || !isLast) next()
          }}
          placeholder={q.type === 'text' || !hasOptions ? 'Escribe tu respuesta' : 'Otro… (escribe aquí)'}
          className="flex-1 bg-transparent text-[13.5px] text-nina-chrome placeholder:text-nina-mute/60 outline-none"
        />
      </div>

      <div className="flex items-center justify-between mt-3">
        <button
          onClick={prev}
          className={`text-[12px] flex items-center gap-1 ${
            step === 0 ? 'opacity-0 pointer-events-none' : 'text-nina-mute hover:text-nina-chrome'
          }`}
        >
          <ChevronLeft className="w-3.5 h-3.5" /> Anterior
        </button>
        <div className="flex items-center gap-1.5">
          {questions.map((_, i) => (
            <span key={i} className={`w-1.5 h-1.5 rounded-full ${i === step ? 'bg-nina-chrome' : 'bg-nina-line'}`} />
          ))}
        </div>
        <div className="flex items-center gap-2">
          {!isLast && (
            <button onClick={next} className="text-[12px] text-nina-mute hover:text-nina-chrome">
              Saltar
            </button>
          )}
          <button
            onClick={next}
            className="px-4 py-1.5 rounded-full bg-silver-gradient text-nina-black text-[12px] font-medium shadow-chrome hover:opacity-90 transition"
          >
            {isLast ? 'Enviar' : 'Siguiente'}
          </button>
        </div>
      </div>
    </motion.div>
  )
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
