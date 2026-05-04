import { LogOut } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Logo from './Logo'

export default function TopBar() {
  const { user, logout } = useAuth()
  const nav = useNavigate()

  const handleLogout = async () => {
    await logout()
    nav('/login', { replace: true })
  }

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
          </div>
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
