import { motion } from 'framer-motion'
import { NavLink, Outlet } from 'react-router-dom'
import { Bot, CheckCircle2, ListTodo, Sparkles, Users } from 'lucide-react'
import TopBar from '../../components/TopBar'

const tabs = [
  { to: '/admin/agentes', icon: Bot, label: 'Agentes' },
  { to: '/admin/tareas', icon: ListTodo, label: 'Tareas' },
  { to: '/admin/aprobaciones', icon: CheckCircle2, label: 'Aprobaciones' },
  { to: '/admin/marcas', icon: Sparkles, label: 'Marcas' },
  { to: '/admin/equipo', icon: Users, label: 'Equipo' },
]

export default function AdminLayout() {
  return (
    <div className="min-h-screen flex flex-col">
      <TopBar />
      <div className="max-w-7xl w-full mx-auto px-4 sm:px-6 pt-6">
        <nav className="flex gap-1 overflow-x-auto pb-2 -mx-2 px-2">
          {tabs.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              className={({ isActive }) =>
                `relative flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition ${
                  isActive ? 'text-nina-black' : 'text-nina-mute hover:text-nina-chrome'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <motion.span
                      layoutId="adminTabBg"
                      className="absolute inset-0 rounded-xl bg-silver-gradient shadow-chrome"
                      transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                    />
                  )}
                  <span className="relative flex items-center gap-2">
                    <t.icon className="w-4 h-4" />
                    {t.label}
                  </span>
                </>
              )}
            </NavLink>
          ))}
        </nav>
      </div>
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 pb-12">
        <Outlet />
      </main>
    </div>
  )
}
