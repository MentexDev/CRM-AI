import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { NavLink, Outlet, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  Activity,
  Bot,
  Brain,
  Calculator,
  Check,
  CheckCircle2,
  Clapperboard,
  Crown,
  Headset,
  KanbanSquare,
  Library,
  ListFilter,
  ListTodo,
  LogOut,
  MessagesSquare,
  Package,
  PanelLeft,
  Pin,
  Settings,
  Smartphone,
  Sparkles,
  Star,
  TrendingUp,
  UserPlus,
  Users,
  X,
} from 'lucide-react'
import TopBar from '../../components/TopBar'
import { ConversationMenu } from '../../components/ConversationMenu'
import { AgentMenu } from '../../components/AgentMenu'
import SettingsModal from '../../components/SettingsModal'
import { useAuth } from '../../context/AuthContext'
import { useAgents } from '../../hooks/useAgents'
import { useConversations } from '../../hooks/useConversations'
import { isSupabaseConfigured, supabase } from '../../lib/supabase'
import { useConnectionStatus } from '../../lib/useConnectionStatus'

function fmtConvTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })
  const yest = new Date(now)
  yest.setDate(now.getDate() - 1)
  if (d.toDateString() === yest.toDateString()) return 'Ayer'
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })
}

const AGENT_STATUS_DOT = {
  idle: 'bg-nina-mute',
  running: 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)] animate-pulse',
  blocked: 'bg-amber-400',
  disabled: 'bg-red-400',
}
const AGENT_SPECIALTY_ICON = {
  analista_tendencias: TrendingUp,
  creador_contenido: Clapperboard,
  contador: Calculator,
  inventarista: Package,
}
function sidebarAgentIcon(a) {
  if (a.role === 'ceo_global') return Crown
  // La ESPECIALIDAD manda (ícono simbólico) sobre el genérico del rol — antes
  // brand_manager cortocircuitaba a Sparkles y Contador/Inventarista salían iguales.
  const bySpecialty = a.specialty && AGENT_SPECIALTY_ICON[a.specialty]
  if (bySpecialty) return bySpecialty
  // Fallback por palabras clave (especialidades libres/sin mapear, p.ej. "Inventarista CRM").
  const k = `${a.name ?? ''} ${a.specialty ?? ''}`.toLowerCase()
  if (/venta|sales|\bcrm\b|kpi|report/.test(k)) return TrendingUp
  if (/contad|finan|conta\b/.test(k)) return Calculator
  if (/content|conteni|market|campañ|redact/.test(k)) return Clapperboard
  if (/inventar|stock|bodega/.test(k)) return Package
  if (a.role === 'brand_manager') return Sparkles
  return Bot
}

// Lista de agentes en el sidebar principal. Click → abre el perfil del agente.
function AgentsNav({ onNavigate, isJunta }) {
  const { agents: rawAgents } = useAgents()
  const { slug } = useParams()
  const [showAll, setShowAll] = useState(false)
  const MAX_VISIBLE = 4
  // Orden del sidebar: fijados arriba, luego el orden manual (sort_order), luego por nombre.
  const agents = [...rawAgents].sort(
    (a, b) => (Number(b.pinned) - Number(a.pinned)) || ((a.sort_order ?? 0) - (b.sort_order ?? 0)) || (a.name || '').localeCompare(b.name || ''),
  )
  // Máximo 4 agentes visibles; el resto detrás de un "+N" que despliega al hacer click
  // (para que el historial de conversaciones no quede empujado fuera de vista). Mantenemos
  // visible el agente ACTIVO aunque quede más allá del tope.
  const shown = (() => {
    if (showAll || agents.length <= MAX_VISIBLE) return agents
    const head = agents.slice(0, MAX_VISIBLE)
    if (slug && !head.some((a) => a.slug === slug)) {
      const active = agents.find((a) => a.slug === slug)
      if (active) return [active, ...head.slice(0, MAX_VISIBLE - 1)]
    }
    return head
  })()

  return (
    <div className="pt-1">
      <div className="px-4 pt-2 pb-1 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-[0.2em] text-nina-mute">Agentes</span>
        {isJunta && (
          <button
            onClick={() => onNavigate('/admin/agentes?new=1')}
            className="w-5 h-5 grid place-items-center rounded text-nina-mute hover:text-nina-chrome hover:bg-nina-line/40 transition"
            title="Nuevo agente"
            aria-label="Nuevo agente"
          >
            <UserPlus className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      <div className="px-2 space-y-0.5">
        {agents.length === 0 ? (
          <div className="px-3 py-2 text-[11px] text-nina-mute">Sin agentes aún</div>
        ) : (
          <>
            {shown.map((a) => {
              const Icon = sidebarAgentIcon(a)
              const isActive = a.slug === slug
              return (
                <div
                  key={a.id}
                  className={`group relative w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg transition ${
                    isActive ? 'bg-nina-line/40' : 'hover:bg-nina-line/25'
                  }`}
                >
                  <button
                    onClick={() => onNavigate(`/admin/agentes/${a.slug}`)}
                    className="flex items-center gap-2.5 min-w-0 flex-1 text-left"
                    title={a.name}
                  >
                    <div className="relative shrink-0">
                      <div className="w-7 h-7 rounded-full grid place-items-center bg-silver-gradient text-nina-black shadow-chrome">
                        <Icon className="w-3.5 h-3.5" />
                      </div>
                      <span
                        className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-nina-panel ${AGENT_STATUS_DOT[a.status] ?? AGENT_STATUS_DOT.idle}`}
                      />
                    </div>
                    <span className="text-[12.5px] text-nina-chrome truncate flex-1">{a.name}</span>
                    {a.pinned && <Pin className="w-3 h-3 text-nina-mute/70 shrink-0" />}
                  </button>
                  {isJunta && (
                    <AgentMenu
                      agent={a}
                      agents={agents}
                      onNavigate={onNavigate}
                      buttonClassName="shrink-0 w-6 h-6 grid place-items-center rounded text-nina-mute hover:text-nina-chrome hover:bg-nina-line/50 opacity-0 group-hover:opacity-100 data-[open=true]:opacity-100 transition"
                    />
                  )}
                </div>
              )
            })}
            {agents.length > MAX_VISIBLE && (
              <button
                onClick={() => setShowAll((v) => !v)}
                className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg transition text-left hover:bg-nina-line/25 text-nina-mute hover:text-nina-chrome"
                title={showAll ? 'Ver menos agentes' : 'Ver todos los agentes'}
              >
                <div className="w-7 h-7 rounded-full grid place-items-center bg-nina-line/40 text-nina-mute shrink-0 text-[12px] font-medium">
                  {showAll ? '−' : `+${agents.length - MAX_VISIBLE}`}
                </div>
                <span className="text-[12.5px] flex-1">{showAll ? 'Ver menos' : 'Ver todos'}</span>
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// Historial de conversaciones — todas las conversaciones con todos los
// agentes, ordenadas por actividad reciente. Click → abre la conversación.
const CONV_FILTERS = [
  { id: 'all', label: 'Todas las conversaciones' },
  { id: 'favorites', label: 'Favoritas' },
  { id: 'archived', label: 'Archivadas' },
]

// Una conversación del historial — título + estrella + menú (⋯).
function ConversationItem({ conv, onNavigate }) {
  const slug = conv.agents?.slug
  return (
    <div className="relative group">
      <button
        onClick={() => slug && onNavigate(`/admin/agentes/${slug}?c=${conv.id}`)}
        className="w-full text-left pl-3 pr-8 py-2 rounded-lg hover:bg-nina-line/30 transition flex items-center gap-1.5"
        title={conv.title}
      >
        <span className="flex-1 min-w-0 text-[12.5px] text-nina-chrome truncate leading-snug">
          {conv.title || 'Conversación'}
        </span>
        {conv.is_favorite && (
          <Star className="w-3 h-3 text-amber-300 shrink-0 fill-amber-300 group-hover:hidden" />
        )}
      </button>
      <div className="absolute top-1.5 right-1.5">
        <ConversationMenu
          conv={conv}
          buttonClassName="w-6 h-6 grid place-items-center rounded text-nina-mute opacity-0 group-hover:opacity-100 hover:text-nina-chrome hover:bg-nina-line/50 transition data-[open=true]:opacity-100"
          menuClassName="right-0 top-7"
        />
      </div>
    </div>
  )
}

function ConversationHistory({ onNavigate }) {
  const { conversations, loading } = useConversations({ limit: 80 })
  const [filter, setFilter] = useState('all')
  const [filterOpen, setFilterOpen] = useState(false)

  const visible = conversations.filter((c) => {
    if (filter === 'favorites') return c.is_favorite && !c.is_archived
    if (filter === 'archived') return c.is_archived
    return !c.is_archived // "all" = no archivadas
  })

  const activeFilter = CONV_FILTERS.find((f) => f.id === filter)

  return (
    <div className="pt-8">
      <div className="px-4 pb-1 flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-[0.2em] text-nina-mute">Conversaciones</span>
        <div className="relative">
          <button
            onClick={() => setFilterOpen((v) => !v)}
            className={`w-6 h-6 grid place-items-center rounded transition ${
              filter !== 'all' || filterOpen
                ? 'text-nina-chrome bg-nina-line/40'
                : 'text-nina-mute hover:text-nina-chrome hover:bg-nina-line/40'
            }`}
            title="Filtrar conversaciones"
            aria-label="Filtrar conversaciones"
          >
            <ListFilter className="w-3.5 h-3.5" />
          </button>
          {filterOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setFilterOpen(false)} />
              <div className="absolute right-0 top-7 z-50 w-56 rounded-xl border border-nina-line bg-nina-panel shadow-xl py-1">
                {CONV_FILTERS.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => {
                      setFilter(f.id)
                      setFilterOpen(false)
                    }}
                    className="w-full flex items-center justify-between gap-2 px-3 py-1.5 text-[12.5px] text-left text-nina-mute hover:text-nina-chrome hover:bg-nina-line/40 transition"
                  >
                    <span>{f.label}</span>
                    {filter === f.id && <Check className="w-3.5 h-3.5 text-nina-chrome shrink-0" />}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      <div className="px-2 space-y-0.5 pb-2">
        {loading ? (
          <div className="px-3 py-3 text-[11px] text-nina-mute">Cargando…</div>
        ) : visible.length === 0 ? (
          <div className="px-3 py-3 text-[11px] text-nina-mute leading-snug">
            {filter === 'all'
              ? 'Aún no hay conversaciones. Escríbele a un agente para empezar.'
              : `No hay conversaciones ${activeFilter?.label.toLowerCase()}.`}
          </div>
        ) : (
          visible.map((c) => (
            <ConversationItem key={c.id} conv={c} onNavigate={onNavigate} />
          ))
        )}
      </div>
    </div>
  )
}

// Workspaces de alto nivel (switcher horizontal estilo Chat/Cowork de Claude).
// Cada workspace tiene su propio sub-menú abajo.
const WORKSPACES = [
  { id: 'agentes', to: '/admin/agentes', icon: Bot, label: 'Agentes' },
  { id: 'atencion', to: '/admin/atencion', icon: Headset, label: 'Atención' },
  { id: 'produccion', to: '/admin/produccion', icon: Clapperboard, label: 'Producción' },
  { id: 'equipo', to: '/admin/equipo', icon: Users, label: 'Equipo' },
]

// Rutas que pertenecen a cada workspace (para saber cuál está activo).
const WORKSPACE_ROUTES = {
  agentes: ['/admin/agentes', '/admin/tareas', '/admin/aprobaciones', '/admin/biblioteca', '/admin/cerebro', '/admin/marcas'],
  atencion: ['/admin/atencion'],
  produccion: ['/admin/produccion'],
  equipo: ['/admin/equipo'],
}

export function getWorkspace(pathname) {
  for (const [id, routes] of Object.entries(WORKSPACE_ROUTES)) {
    if (routes.some((r) => pathname.startsWith(r))) return id
  }
  return 'agentes'
}

// Sub-menú (nav vertical) propio de cada workspace.
const WORKSPACE_NAV = {
  agentes: [
    { to: '/admin/tareas', icon: ListTodo, label: 'Tareas' },
    { to: '/admin/aprobaciones', icon: CheckCircle2, label: 'Aprobaciones' },
    { to: '/admin/biblioteca', icon: Library, label: 'Biblioteca' },
    { to: '/admin/cerebro', icon: Brain, label: 'Cerebro' },
    { to: '/admin/marcas', icon: Sparkles, label: 'Marcas' },
    { to: '/admin/salud', icon: Activity, label: 'Salud' },
  ],
  atencion: [
    { to: '/admin/atencion', icon: KanbanSquare, label: 'Pipeline', end: true },
    { to: '/admin/atencion/conversaciones', icon: MessagesSquare, label: 'Conversaciones' },
    { to: '/admin/atencion/contactos', icon: Users, label: 'Contactos' },
    { to: '/admin/atencion/canales', icon: Smartphone, label: 'Canales' },
    { to: '/admin/atencion/config', icon: Settings, label: 'Configuración' },
  ],
  produccion: [], // se llenará cuando definamos Producción
  equipo: [],
}

// Tooltip estilo Manus para el sidebar COLAPSADO: un pill oscuro a la derecha del ícono que
// dice de qué trata esa pestaña. Usa portal + posición FIXED medida al hacer hover, para
// escapar del overflow-hidden del layout raíz y del overflow-y-auto del sidebar (un tooltip
// posicionado con CSS absolute quedaría recortado por esos contenedores).
function SidebarTip({ label, children, disabled = false }) {
  const ref = useRef(null)
  const [coords, setCoords] = useState(null)
  const show = () => {
    if (disabled || !label) return
    const r = ref.current?.getBoundingClientRect()
    if (r) setCoords({ top: r.top + r.height / 2, left: r.right + 10 })
  }
  const hide = () => setCoords(null)
  return (
    <div ref={ref} onMouseEnter={show} onMouseLeave={hide} onMouseDown={hide} className="relative">
      {children}
      {coords &&
        createPortal(
          <div
            role="tooltip"
            style={{ top: coords.top, left: coords.left }}
            className="fixed -translate-y-1/2 z-[200] px-2.5 py-1 rounded-lg bg-[#0b0c10] border border-nina-line text-nina-chrome text-[12.5px] font-medium whitespace-nowrap shadow-xl pointer-events-none"
          >
            {label}
          </div>,
          document.body,
        )}
    </div>
  )
}

function SectionSwitcher({ collapsed, active, onSelect }) {
  const navigate = useNavigate()
  const go = (to) => {
    navigate(to)
    onSelect?.()
  }

  if (collapsed) {
    return (
      <div className="px-2 pt-3 flex flex-col gap-1">
        {WORKSPACES.map((s) => (
          <SidebarTip key={s.id} label={s.label}>
            <button
              onClick={() => go(s.to)}
              aria-label={s.label}
              className={`w-full h-9 grid place-items-center rounded-xl transition ${
                active === s.id
                  ? 'bg-silver-gradient text-nina-black shadow-chrome'
                  : 'text-nina-mute hover:text-nina-chrome hover:bg-nina-line/30'
              }`}
            >
              <s.icon className="w-4 h-4" />
            </button>
          </SidebarTip>
        ))}
      </div>
    )
  }

  return (
    <div className="px-3 pt-3 flex gap-1.5">
      {WORKSPACES.map((s) => (
        <button
          key={s.id}
          onClick={() => go(s.to)}
          title={s.label}
          className={`flex items-center justify-center gap-2 h-9 rounded-xl overflow-hidden border transition-all duration-300 ease-out ${
            active === s.id
              ? 'flex-1 px-3 bg-nina-line/50 border-nina-line text-nina-chrome'
              : 'w-9 px-0 bg-nina-line/15 border-transparent text-nina-mute hover:text-nina-chrome hover:bg-nina-line/35'
          }`}
        >
          <s.icon className="w-4 h-4 shrink-0" />
          {active === s.id && <span className="text-[13px] font-medium whitespace-nowrap">{s.label}</span>}
        </button>
      ))}
    </div>
  )
}

// Nota: el estado colapsado NO se persiste a propósito — Brandon prefiere
// que cada refresh arranque con el sidebar colapsado (icon-only) para
// maximizar el espacio del chat. Si el usuario lo expande, dura sólo
// dentro de la sesión visual.

// Estado de conexión: poller COMPARTIDO global (un solo ping para toda la app, no uno
// por componente). Ver lib/useConnectionStatus.
const useConnectionState = useConnectionStatus

const INDICATOR = {
  online: { dot: 'bg-emerald-400', label: 'En línea', shadow: 'shadow-[0_0_8px_rgba(52,211,153,0.6)]' },
  offline: { dot: 'bg-red-400', label: 'Sin conexión', shadow: '' },
  local: { dot: 'bg-amber-400', label: 'Local', shadow: '' },
  idle: { dot: 'bg-nina-mute', label: 'Conectando…', shadow: '' },
}

function NavItems({ items, collapsed, onSelect }) {
  if (!items?.length) return null
  return (
    <nav className={`shrink-0 ${collapsed ? 'px-2' : 'px-2.5'} py-3 space-y-0.5`}>
      {items.map((t) => {
        const link = (
          <NavLink
            to={t.to}
            end={t.end}
            onClick={onSelect}
            aria-label={t.label}
            className={({ isActive }) =>
              `relative flex items-center ${
                collapsed ? 'justify-center px-0 py-2.5' : 'gap-3 px-3 py-2.5'
              } rounded-xl text-sm font-medium transition ${
                isActive ? 'text-nina-black' : 'text-nina-mute hover:text-nina-chrome hover:bg-nina-line/30'
              }`
            }
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <motion.span
                    layoutId="sidebarActive"
                    className="absolute inset-0 rounded-xl bg-silver-gradient shadow-chrome"
                    transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                  />
                )}
                <span
                  className={`relative flex items-center ${
                    collapsed ? 'justify-center' : 'gap-3'
                  }`}
                >
                  <t.icon className="w-4 h-4" />
                  {!collapsed && <span>{t.label}</span>}
                </span>
              </>
            )}
          </NavLink>
        )
        return collapsed ? (
          <SidebarTip key={t.to} label={t.label}>{link}</SidebarTip>
        ) : (
          <Fragment key={t.to}>{link}</Fragment>
        )
      })}
    </nav>
  )
}

function SidebarUserBlock({ collapsed, onOpenSettings }) {
  const { user } = useAuth()
  const conn = useConnectionState()
  const indicator = INDICATOR[conn]

  if (collapsed) {
    return (
      <div className="px-2 py-2 border-t border-nina-line flex flex-col items-center gap-1.5">
        <SidebarTip label={user?.fullName ? `${user.fullName}${user.roleLabel ? ` · ${user.roleLabel}` : ''} — ${indicator.label}` : indicator.label}>
          <div className="relative">
            <div className="w-9 h-9 rounded-full grid place-items-center bg-silver-gradient text-nina-black font-bold text-xs shadow-chrome">
              {user?.avatarText}
            </div>
            <span
              className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-nina-panel ${indicator.dot} ${indicator.shadow}`}
            />
          </div>
        </SidebarTip>
        <SidebarTip label="Configuración">
          <button
            onClick={onOpenSettings}
            className="w-8 h-8 grid place-items-center rounded-lg text-nina-mute hover:text-nina-chrome hover:bg-nina-line/30 transition"
            aria-label="Configuración"
          >
            <Settings className="w-4 h-4" />
          </button>
        </SidebarTip>
      </div>
    )
  }

  return (
    <div className="px-3 py-3 border-t border-nina-line">
      <div className="flex items-center gap-2.5">
        <div className="relative shrink-0">
          <div className="w-9 h-9 rounded-full grid place-items-center bg-silver-gradient text-nina-black font-bold text-xs shadow-chrome">
            {user?.avatarText}
          </div>
          <span
            className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-nina-panel ${indicator.dot} ${indicator.shadow}`}
          />
        </div>
        <div className="flex-1 min-w-0 leading-tight">
          <div className="text-sm font-medium text-nina-chrome truncate">{user?.fullName}</div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-nina-mute truncate">
            {user?.roleLabel}
          </div>
          <div className="text-[9px] uppercase tracking-[0.18em] text-nina-mute mt-0.5">
            {indicator.label}
          </div>
        </div>
        <button
          onClick={onOpenSettings}
          className="btn-ghost !p-2 shrink-0"
          title="Configuración"
          aria-label="Configuración"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

function SidebarBrandFooter({ collapsed }) {
  if (collapsed) {
    return (
      <div className="px-2 py-2 border-t border-nina-line grid place-items-center">
        <span className="text-[9px] uppercase tracking-[0.2em] text-nina-mute/60">v0.2</span>
      </div>
    )
  }
  return (
    <div className="px-4 py-3 border-t border-nina-line">
      <div className="text-[10px] uppercase tracking-[0.32em] text-nina-mute/70">
        Mentex Holding
      </div>
      <div className="text-[11px] text-nina-mute mt-0.5">v0.2 · Multi-Agent CRM</div>
    </div>
  )
}

// Marca: (logo) · (logo2). Centrados con items-center (mismo eje), logo1 entra
// desde abajo y logo2 desde arriba. Reusado en sidebar desktop y menú mobile.
function BrandLogos() {
  return (
    <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
      <motion.img
        src="/logo-crm.png"
        alt="CRM"
        initial={{ opacity: 0, y: 22 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: 'easeOut', delay: 0.05 }}
        className="h-[2.6rem] w-auto object-contain block"
      />
      <span className="silver-text-static font-display font-bold text-xl leading-none">·</span>
      <motion.img
        src="/log-crm2.png"
        alt="Mentex"
        initial={{ opacity: 0, y: -22 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: 'easeOut', delay: 0.05 }}
        className="h-[1.7rem] w-auto object-contain block"
      />
    </div>
  )
}

function SidebarHeader({ collapsed, onToggle }) {
  if (collapsed) {
    // Colapsado: muestra la "A" del favicon; en hover aparece el icono de
    // panel para abrir el sidebar.
    return (
      <div className="px-2 py-3 border-b border-nina-line flex justify-center">
        <SidebarTip label="Mostrar menú">
          <button
            onClick={onToggle}
            className="group relative w-9 h-9 grid place-items-center rounded-lg hover:bg-nina-line/30 transition"
            aria-label="Mostrar menú"
          >
            <img
              src="/favicon-32.png"
              alt="A"
              className="w-6 h-6 object-contain transition group-hover:opacity-0"
            />
            <PanelLeft className="w-4 h-4 absolute text-nina-chrome opacity-0 transition group-hover:opacity-100" />
          </button>
        </SidebarTip>
      </div>
    )
  }
  // Expandido: (logo) · (logo2). logo1 sube desde abajo; logo2 baja desde arriba.
  return (
    <div className="px-4 py-4 border-b border-nina-line flex items-center justify-between gap-3">
      <BrandLogos />
      <button
        onClick={onToggle}
        className="w-8 h-8 grid place-items-center rounded-lg text-nina-mute hover:text-nina-chrome hover:bg-nina-line/30 transition shrink-0"
        title="Ocultar menú"
        aria-label="Ocultar menú"
      >
        <PanelLeft className="w-4 h-4" />
      </button>
    </div>
  )
}

export default function AdminLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  // Siempre colapsado al cargar la página — Brandon quiere maximizar el
  // espacio del chat por default. El toggle expande dentro de la sesión
  // pero el refresh resetea.
  const [collapsed, setCollapsed] = useState(
    () => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('canvas') === '1',
  )
  const [settingsOpen, setSettingsOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const { isJunta } = useAuth()
  const workspace = getWorkspace(location.pathname)
  // F5: la entrada "Salud" del nav es solo para la Junta (un no-junta vería el panel vacío).
  const navItems = (WORKSPACE_NAV[workspace] ?? []).filter((it) => it.to !== '/admin/salud' || isJunta)
  // El chat marca ?canvas=1 cuando abre el split-view → ocultamos el sidebar
  // para darle todo el espacio al canvas.
  const [searchParams] = useSearchParams()
  const canvasOpen = searchParams.get('canvas') === '1'
  // El sidebar sigue al browser: al ABRIRLO se colapsa (más espacio para el canvas) y al
  // OCULTARLO se EXPANDE de nuevo automáticamente. Entre cambios del browser, el toggle
  // manual manda (este efecto solo corre cuando canvasOpen cambia).
  useEffect(() => {
    setCollapsed(canvasOpen)
  }, [canvasOpen])

  useEffect(() => {
    setDrawerOpen(false)
  }, [location.pathname])

  const toggleCollapsed = () => setCollapsed((prev) => !prev)

  return (
    <div className="h-screen overflow-hidden flex">
      {/* Sidebar desktop fijo · ancho dependiente del modo collapsed */}
      <aside
        className={`hidden lg:flex flex-col border-r border-nina-line bg-nina-panel/95 sticky top-0 h-screen transition-[width] duration-200 ease-out ${
          collapsed ? 'w-16' : 'w-64'
        }`}
      >
        <SidebarHeader collapsed={collapsed} onToggle={toggleCollapsed} />
        <SectionSwitcher collapsed={collapsed} active={workspace} />
        <NavItems items={navItems} collapsed={collapsed} />
        {workspace === 'agentes' && !collapsed ? (
          <div className="flex-1 min-h-0 overflow-y-auto border-t border-nina-line/60 mt-1">
            <AgentsNav onNavigate={(to) => navigate(to)} isJunta={isJunta} />
            <ConversationHistory onNavigate={(to) => navigate(to)} />
          </div>
        ) : (
          <div className="flex-1" />
        )}
        <SidebarUserBlock collapsed={collapsed} onOpenSettings={() => setSettingsOpen(true)} />
      </aside>

      {/* Sidebar mobile como drawer — siempre expandido */}
      <AnimatePresence>
        {drawerOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDrawerOpen(false)}
              className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm lg:hidden"
            />
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', stiffness: 320, damping: 32 }}
              className="fixed inset-y-0 left-0 z-50 w-64 flex flex-col border-r border-nina-line bg-nina-panel lg:hidden"
              style={{ paddingTop: 'env(safe-area-inset-top)' }}
            >
              <div className="px-5 py-5 border-b border-nina-line flex items-center justify-between">
                <BrandLogos />
                <button
                  onClick={() => setDrawerOpen(false)}
                  className="btn-ghost !p-2"
                  aria-label="Cerrar menú"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <SectionSwitcher collapsed={false} active={workspace} onSelect={() => setDrawerOpen(false)} />
              <NavItems items={navItems} collapsed={false} onSelect={() => setDrawerOpen(false)} />
              {workspace === 'agentes' ? (
                <div className="flex-1 min-h-0 overflow-y-auto border-t border-nina-line/60 mt-1">
                  <AgentsNav
                    onNavigate={(to) => {
                      navigate(to)
                      setDrawerOpen(false)
                    }}
                    isJunta={isJunta}
                  />
                  <ConversationHistory
                    onNavigate={(to) => {
                      navigate(to)
                      setDrawerOpen(false)
                    }}
                  />
                </div>
              ) : (
                <div className="flex-1" />
              )}
              <SidebarUserBlock
                collapsed={false}
                onOpenSettings={() => {
                  setDrawerOpen(false)
                  setSettingsOpen(true)
                }}
              />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Columna principal */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* TopBar SOLO mobile: hamburger + indicador chico.
            En desktop la info del usuario vive en el sidebar. */}
        <div className="lg:hidden">
          <TopBar onMenuClick={() => setDrawerOpen(true)} />
        </div>
        {/* En lg+ main es full-bleed (sin padding/max-width) para que las
            páginas tipo chat (Agents) puedan pegarse al sidebar. Las páginas
            de listings agregan su propio padding interno (lg:px-6 lg:pt-4). */}
        <main
          className="flex-1 min-h-0 overflow-y-auto w-full max-w-7xl mx-auto px-4 sm:px-6 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))] lg:max-w-none lg:mx-0 lg:px-0 lg:pt-0 lg:pb-0"
        >
          <Outlet />
        </main>
      </div>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}
