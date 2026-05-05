import { useEffect, useState } from 'react'
import { LogOut } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Logo from './Logo'
import { isSupabaseConfigured, supabase } from '../lib/supabase'

export default function TopBar() {
  const { user, logout } = useAuth()
  const nav = useNavigate()

  // Estado de conexión: idle | online | offline
  const [conn, setConn] = useState('idle')

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setConn('local')
      return
    }
    let alive = true
    const ping = async () => {
      try {
        const { error } = await supabase.from('profiles').select('id').limit(1)
        if (!alive) return
        setConn(error ? 'offline' : 'online')
      } catch {
        if (alive) setConn('offline')
      }
    }
    ping()
    const handler = () => ping()
    window.addEventListener('online', handler)
    window.addEventListener('offline', () => alive && setConn('offline'))
    const interval = setInterval(ping, 30000)
    return () => {
      alive = false
      clearInterval(interval)
      window.removeEventListener('online', handler)
      window.removeEventListener('offline', handler)
    }
  }, [user?.id])

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
    <header className="sticky top-0 z-30 backdrop-blur-md bg-nina-black/60 border-b border-nina-line">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-4">
        <Logo size="sm" subtitle={false} />
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex flex-col items-end leading-tight">
            <span className="text-sm font-medium text-nina-chrome">{user?.name}</span>
            <span className="text-[10px] uppercase tracking-[0.2em] text-nina-mute">
              {user?.role === 'admin' ? 'Administrador' : 'Vendedora'}
            </span>
            <span
              className="flex items-center gap-1 text-[9px] uppercase tracking-[0.18em] text-nina-mute mt-0.5"
              title={`Estado: ${indicator.label}`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${indicator.dot} ${indicator.shadow}`}
              />
              {indicator.label}
            </span>
          </div>
          {/* En móvil: solo el punto de estado al lado del avatar */}
          <span
            className={`sm:hidden w-2 h-2 rounded-full ${indicator.dot} ${indicator.shadow}`}
            title={indicator.label}
          />
          <div className="w-10 h-10 rounded-full grid place-items-center bg-silver-gradient text-nina-black font-bold text-sm shadow-chrome">
            {user?.avatar || user?.name?.[0]}
          </div>
          <button onClick={handleLogout} className="btn-ghost !p-2.5" title="Cerrar sesión">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  )
}
