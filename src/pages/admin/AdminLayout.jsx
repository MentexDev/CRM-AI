import { motion } from 'framer-motion'
import { NavLink, Outlet } from 'react-router-dom'
import { LayoutDashboard, Package, Users, Receipt, Trophy, Gift } from 'lucide-react'
import TopBar from '../../components/TopBar'

const tabs = [
  { to: '/admin', icon: LayoutDashboard, label: 'Resumen', end: true },
  { to: '/admin/inventario', icon: Package, label: 'Inventario' },
  { to: '/admin/vendedoras', icon: Users, label: 'Vendedoras' },
  { to: '/admin/ventas', icon: Receipt, label: 'Ventas' },
  { to: '/admin/ranking', icon: Trophy, label: 'Ranking' },
  { to: '/admin/premios', icon: Gift, label: 'Premios' },
]

export default function AdminLayout() {
  return (
    <div className="min-h-screen">
      <TopBar />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-6">
        <nav className="flex gap-1 overflow-x-auto pb-2 -mx-2 px-2">
          {tabs.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                `relative flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition ${
                  isActive
                    ? 'text-nina-black'
                    : 'text-nina-mute hover:text-nina-chrome'
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
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <Outlet />
      </main>
    </div>
  )
}
