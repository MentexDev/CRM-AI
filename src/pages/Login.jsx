import { useState } from 'react'
import { motion } from 'framer-motion'
import { AtSign, Eye, EyeOff, Lock, Sparkles } from 'lucide-react'
import { Navigate, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useAuth } from '../context/AuthContext'
import Logo from '../components/Logo'
import { isSupabaseConfigured } from '../lib/supabase'

export default function Login() {
  const { user, login } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const nav = useNavigate()

  if (user) return <Navigate to={user.role === 'admin' ? '/admin' : '/vendedora'} replace />

  const submit = async (e) => {
    e.preventDefault()
    if (!username || !password) {
      toast.error('Ingresa usuario y contraseña')
      return
    }
    setBusy(true)
    try {
      const u = await login(username.trim(), password)
      toast.success(`Bienvenida${u.role === 'admin' ? '' : ', ' + u.name.split(' ')[0]}`)
      nav(u.role === 'admin' ? '/admin' : '/vendedora', { replace: true })
    } catch (err) {
      toast.error(err.message || 'No se pudo iniciar sesión')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen relative overflow-hidden flex items-center justify-center px-4 py-10">
      {/* Fondo animado */}
      <motion.div
        aria-hidden
        className="absolute -top-40 -left-40 w-[600px] h-[600px] rounded-full"
        style={{
          background:
            'radial-gradient(circle, rgba(232,232,232,0.18), transparent 60%)',
        }}
        animate={{ x: [0, 40, 0], y: [0, 30, 0] }}
        transition={{ duration: 14, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        aria-hidden
        className="absolute -bottom-40 -right-40 w-[600px] h-[600px] rounded-full"
        style={{
          background:
            'radial-gradient(circle, rgba(200,200,200,0.12), transparent 60%)',
        }}
        animate={{ x: [0, -30, 0], y: [0, -20, 0] }}
        transition={{ duration: 16, repeat: Infinity, ease: 'easeInOut' }}
      />

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: 'easeOut' }}
        className="relative w-full max-w-md panel p-8 sm:p-10"
      >
        <div className="flex flex-col items-center mb-8">
          <Logo size="lg" />
        </div>

        <form onSubmit={submit} className="space-y-5">
          <div>
            <label className="label">Usuario</label>
            <div className="relative">
              <AtSign className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-nina-mute" />
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="NINAnombre.apellido"
                className="input pl-10"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>
          </div>

          <div>
            <label className="label">Contraseña</label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-nina-mute" />
              <input
                type={show ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="input pl-10 pr-10"
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-nina-mute hover:text-nina-chrome transition"
              >
                {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <button type="submit" disabled={busy} className="btn-primary w-full !py-3">
            {busy ? 'Ingresando…' : 'Entrar'}
          </button>
        </form>

        {!isSupabaseConfigured && (
          <div className="mt-6 text-[11px] text-nina-mute leading-relaxed border-t border-nina-line pt-5">
            <div className="flex items-center gap-1.5 text-amber-300/80 uppercase tracking-[0.2em]">
              <Sparkles className="w-3 h-3" /> Modo local
            </div>
            <p className="mt-2">
              Los datos se guardan en este navegador. Para compartir con tu equipo
              configura Supabase (ver README).
            </p>
          </div>
        )}
      </motion.div>

      <div className="absolute bottom-6 text-[10px] uppercase tracking-[0.4em] text-nina-mute/60">
        Feria WEIN · Medellín
      </div>
    </div>
  )
}
