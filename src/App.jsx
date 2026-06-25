import { useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import Login from './pages/Login'
import AdminLayout from './pages/admin/AdminLayout'
import Agents from './pages/admin/Agents'
import Tasks from './pages/admin/Tasks'
import Approvals from './pages/admin/Approvals'
import Biblioteca from './pages/admin/Biblioteca'
import Plantillas from './pages/admin/Plantillas'
import PublishedModule from './pages/admin/PublishedModule'
import Cerebro from './pages/admin/Cerebro'
import Brands from './pages/admin/Brands'
import Produccion from './pages/admin/Produccion'
import Team from './pages/admin/Team'
import Salud from './pages/admin/Salud'
import CsPipeline from './pages/admin/cs/Pipeline'
import CsInbox from './pages/admin/cs/Inbox'
import CsContacts from './pages/admin/cs/Contacts'
import CsChannels from './pages/admin/cs/Channels'
import CsSettings from './pages/admin/cs/Settings'

function Protected({ children }) {
  const { user, loading } = useAuth()
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
                Está tardando más de lo normal. Puede ser sesión expirada o conexión lenta.
              </p>
              <div className="flex gap-2 justify-center">
                <button className="btn-ghost text-xs" onClick={() => window.location.reload()}>
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
  return children
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/admin"
        element={
          <Protected>
            <AdminLayout />
          </Protected>
        }
      >
        <Route index element={<Navigate to="agentes" replace />} />
        <Route path="agentes" element={<Agents />} />
        <Route path="agentes/:slug" element={<Agents />} />
        <Route path="tareas" element={<Tasks />} />
        <Route path="aprobaciones" element={<Approvals />} />
        <Route path="biblioteca" element={<Biblioteca />} />
        <Route path="plantillas" element={<Plantillas />} />
        <Route path="modulos/:id" element={<PublishedModule />} />
        <Route path="cerebro" element={<Cerebro />} />
        <Route path="produccion" element={<Produccion />} />
        <Route path="marcas" element={<Brands />} />
        <Route path="salud" element={<Salud />} />
        <Route path="equipo" element={<Team />} />
        <Route path="atencion" element={<CsPipeline />} />
        <Route path="atencion/conversaciones" element={<CsInbox />} />
        <Route path="atencion/contactos" element={<CsContacts />} />
        <Route path="atencion/canales" element={<CsChannels />} />
        <Route path="atencion/config" element={<CsSettings />} />
      </Route>
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  )
}
