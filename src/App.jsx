import { useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import Login from './pages/Login'
import AdminLayout from './pages/admin/AdminLayout'
import Overview from './pages/admin/Overview'
import Inventory from './pages/admin/Inventory'
import Sellers from './pages/admin/Sellers'
import Sales from './pages/admin/Sales'
import Ranking from './pages/admin/Ranking'
import Prizes from './pages/admin/Prizes'
import SellerDashboard from './pages/seller/SellerDashboard'

function Protected({ children, role }) {
  const { user, loading } = useAuth()
  // Si pasan más de 6s en loading, ofrecemos una salida limpia (recargar / login)
  const [stuck, setStuck] = useState(false)
  useEffect(() => {
    if (!loading) return
    const t = setTimeout(() => setStuck(true), 6000)
    return () => clearTimeout(t)
  }, [loading])

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center px-4">
        <div className="text-center space-y-4">
          <div className="silver-text font-display text-xl tracking-[0.2em]">CARGANDO…</div>
          {stuck && (
            <div className="space-y-3 max-w-sm">
              <p className="text-xs text-nina-mute">
                Está tardando más de lo normal. Puede ser sesión expirada o conexión
                lenta.
              </p>
              <div className="flex gap-2 justify-center">
                <button
                  className="btn-ghost text-xs"
                  onClick={() => window.location.reload()}
                >
                  Reintentar
                </button>
                <button
                  className="btn-primary text-xs"
                  onClick={async () => {
                    try {
                      const { supabase } = await import('./lib/supabase')
                      if (supabase) await supabase.auth.signOut()
                    } catch {}
                    localStorage.clear()
                    window.location.href = '/login'
                  }}
                >
                  Volver al login
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }
  if (!user) return <Navigate to="/login" replace />
  if (role && user.role !== role) {
    return <Navigate to={user.role === 'admin' ? '/admin' : '/vendedora'} replace />
  }
  return children
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/admin"
        element={
          <Protected role="admin">
            <AdminLayout />
          </Protected>
        }
      >
        <Route index element={<Overview />} />
        <Route path="inventario" element={<Inventory />} />
        <Route path="vendedoras" element={<Sellers />} />
        <Route path="ventas" element={<Sales />} />
        <Route path="ranking" element={<Ranking />} />
        <Route path="premios" element={<Prizes />} />
      </Route>
      <Route
        path="/vendedora"
        element={
          <Protected role="seller">
            <SellerDashboard />
          </Protected>
        }
      />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  )
}
