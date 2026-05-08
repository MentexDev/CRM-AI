import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { Bot, CheckCircle2, ListTodo, Sparkles, Users, X } from 'lucide-react'
import TopBar from '../../components/TopBar'
import Logo from '../../components/Logo'

const tabs = [
  { to: '/admin/agentes', icon: Bot, label: 'Agentes' },
  { to: '/admin/tareas', icon: ListTodo, label: 'Tareas' },
  { to: '/admin/aprobaciones', icon: CheckCircle2, label: 'Aprobaciones' },
  { to: '/admin/marcas', icon: Sparkles, label: 'Marcas' },
  { to: '/admin/equipo', icon: Users, label: 'Equipo' },
]

function NavItems({ onSelect }) {
  return (
    <nav className="flex-1 px-2.5 py-3 space-y-0.5">
      {tabs.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          onClick={onSelect}
          className={({ isActive }) =>
            `relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition ${
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
              <span className="relative flex items-center gap-3">
                <t.icon className="w-4 h-4" />
                {t.label}
              </span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
}

function SidebarFooter() {
  return (
    <div className="px-5 py-4 border-t border-nina-line">
      <div className="text-[10px] uppercase tracking-[0.32em] text-nina-mute/70">
        Mentex Holding
      </div>
      <div className="text-[11px] text-nina-mute mt-1">v0.2 · Multi-Agent CRM</div>
    </div>
  )
}

export default function AdminLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const location = useLocation()

  // Cerrar drawer al cambiar de ruta (en mobile)
  useEffect(() => {
    setDrawerOpen(false)
  }, [location.pathname])

  return (
    <div className="min-h-screen flex">
      {/* Sidebar desktop fijo */}
      <aside className="hidden lg:flex w-60 flex-col border-r border-nina-line bg-nina-panel/40 backdrop-blur-sm sticky top-0 h-screen">
        <div className="px-5 py-6 border-b border-nina-line">
          <Logo size="sm" subtitle={false} />
        </div>
        <NavItems />
        <SidebarFooter />
      </aside>

      {/* Sidebar mobile como drawer */}
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
                <Logo size="sm" subtitle={false} />
                <button
                  onClick={() => setDrawerOpen(false)}
                  className="btn-ghost !p-2"
                  aria-label="Cerrar menú"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <NavItems onSelect={() => setDrawerOpen(false)} />
              <SidebarFooter />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Columna principal */}
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar onMenuClick={() => setDrawerOpen(true)} />
        <main
          className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 pt-5 sm:pt-6"
          style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }}
        >
          <Outlet />
        </main>
      </div>
    </div>
  )
}
