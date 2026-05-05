import { useState } from 'react'
import { motion } from 'framer-motion'
import { NavLink, Outlet } from 'react-router-dom'
import {
  Gift,
  LayoutDashboard,
  Package,
  Plus,
  Receipt,
  Trophy,
  Users,
} from 'lucide-react'
import TopBar from '../../components/TopBar'
import SaleModal from '../../components/SaleModal'

const tabs = [
  { to: '/admin', icon: LayoutDashboard, label: 'Resumen', end: true },
  { to: '/admin/inventario', icon: Package, label: 'Inventario' },
  { to: '/admin/vendedoras', icon: Users, label: 'Vendedoras' },
  { to: '/admin/ventas', icon: Receipt, label: 'Ventas' },
  { to: '/admin/ranking', icon: Trophy, label: 'Ranking' },
  { to: '/admin/premios', icon: Gift, label: 'Premios' },
]

export default function AdminLayout() {
  const [saleOpen, setSaleOpen] = useState(false)

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
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 pb-28">
        <Outlet />
      </main>

      {/* FAB siempre visible: registrar venta */}
      <motion.button
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.2, type: 'spring', stiffness: 260, damping: 20 }}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => setSaleOpen(true)}
        className="fixed bottom-6 right-6 z-30 btn-primary !rounded-full !p-4 shadow-glow group"
        aria-label="Registrar venta"
        title="Registrar venta"
      >
        <Plus className="w-6 h-6" />
        <span className="hidden md:inline absolute right-full mr-3 top-1/2 -translate-y-1/2 px-3 py-1.5 rounded-lg bg-nina-panel border border-nina-line text-xs text-nina-chrome whitespace-nowrap opacity-0 group-hover:opacity-100 transition pointer-events-none">
          Registrar venta
        </span>
      </motion.button>

      <SaleModal open={saleOpen} onClose={() => setSaleOpen(false)} />
    </div>
  )
}
