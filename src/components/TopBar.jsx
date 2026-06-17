import { useEffect, useState } from 'react'
import { LogOut, Menu } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useConnectionStatus } from '../lib/useConnectionStatus'

export default function TopBar({ onMenuClick }) {
  const { user, logout } = useAuth()
  const nav = useNavigate()

  // Estado de conexión (poller COMPARTIDO global — ver lib/useConnectionStatus).
  const conn = useConnectionStatus()

  const handleLogout = async () => {
    await logout()
    nav('/login', { replace: true })
  }

  const indicator = {
    online: { dot: 'bg-emerald-400', label: 'En línea', shadow: 'shadow-[0_0_8px_rgba(52,211,153,0.6)]' },
    offline: { dot: 'bg-red-400', label: 'Sin conexión', shadow: '' },
    local: { dot: 'bg-amber-400', label: 'Local', shadow: '' },
    idle: { dot: 'bg-nina-mute', label: 'Conectando…', shadow: '' },
  }[conn]

  return (
    <header
      className="sticky top-0 z-30 bg-nina-black/95 border-b border-nina-line"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div
        className="py-3 sm:py-4 flex items-center justify-between gap-3"
        style={{
          paddingLeft: 'max(1rem, env(safe-area-inset-left))',
          paddingRight: 'max(1rem, env(safe-area-inset-right))',
        }}
      >
        {/* Izquierda: hamburger en mobile */}
        <button
          onClick={onMenuClick}
          className="lg:hidden btn-ghost !p-2"
          aria-label="Abrir menú"
        >
          <Menu className="w-4 h-4" />
        </button>
        <div className="hidden lg:block" />

        {/* Derecha: estado + user */}
        <div className="flex items-center gap-3 ml-auto">
          <div className="hidden sm:flex flex-col items-end leading-tight">
            <span className="text-sm font-medium text-nina-chrome">{user?.fullName}</span>
            <span className="text-[10px] uppercase tracking-[0.2em] text-nina-mute">
              {user?.roleLabel}
            </span>
            <span
              className="flex items-center gap-1 text-[9px] uppercase tracking-[0.18em] text-nina-mute mt-0.5"
              title={`Estado: ${indicator.label}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${indicator.dot} ${indicator.shadow}`} />
              {indicator.label}
            </span>
          </div>
          <span
            className={`sm:hidden w-2 h-2 rounded-full ${indicator.dot} ${indicator.shadow}`}
            title={indicator.label}
          />
          <div className="w-10 h-10 rounded-full grid place-items-center bg-silver-gradient text-nina-black font-bold text-sm shadow-chrome">
            {user?.avatarText}
          </div>
          <button onClick={handleLogout} className="btn-ghost !p-2.5" title="Cerrar sesión">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  )
}
