import { useEffect, useState } from 'react'
import { LogOut } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Logo from './Logo'
import { isSupabaseConfigured, supabase } from '../lib/supabase'

export default function TopBar() {
  const { user, logout } = useAuth()
  const nav = useNavigate()

  // Estado de conexión: idle | online | offline | local
  // Si hay user (al menos del cache) asumimos online optimista hasta que un ping falle.
  const [conn, setConn] = useState(() => {
    if (!isSupabaseConfigured) return 'local'
    return user ? 'online' : 'idle'
  })

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setConn('local')
      return
    }
    let alive = true
    let consecutiveFailures = 0

    const ping = async () => {
      try {
        const { error } = await supabase.from('profiles').select('id').limit(1)
        if (!alive) return
        if (error) {
          consecutiveFailures += 1
          // Solo marcamos offline tras 2 fallos seguidos para no parpadear con blips
          if (consecutiveFailures >= 2) setConn('offline')
        } else {
          consecutiveFailures = 0
          setConn('online')
        }
      } catch {
        consecutiveFailures += 1
        if (alive && consecutiveFailures >= 2) setConn('offline')
      }
    }
    ping()
    const onlineHandler = () => {
      consecutiveFailures = 0
      ping()
    }
    const offlineHandler = () => alive && setConn('offline')
    window.addEventListener('online', onlineHandler)
    window.addEventListener('offline', offlineHandler)
    const interval = setInterval(ping, 30000)
    return () => {
      alive = false
      clearInterval(interval)
      window.removeEventListener('online', onlineHandler)
      window.removeEventListener('offline', offlineHandler)
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
    <header
      className="sticky top-0 z-30 backdrop-blur-md bg-nina-black/60 border-b border-nina-line"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div
        className="max-w-7xl mx-auto py-4 flex items-center justify-between gap-4"
        style={{
          paddingLeft: 'max(1rem, env(safe-area-inset-left))',
          paddingRight: 'max(1rem, env(safe-area-inset-right))',
        }}
      >
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
