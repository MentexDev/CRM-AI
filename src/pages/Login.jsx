import { useState } from 'react'
import { motion } from 'framer-motion'
import { AtSign, Eye, EyeOff, Lock } from 'lucide-react'
import { Navigate, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useAuth } from '../context/AuthContext'
import Logo from '../components/Logo'

export default function Login() {
  const { user, login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const nav = useNavigate()

  if (user) return <Navigate to="/admin" replace />

  const submit = async (e) => {
    e.preventDefault()
    if (!email || !password) {
      toast.error('Ingresa email y contraseña')
      return
    }
    setBusy(true)
    try {
      const u = await login(email.trim(), password)
      toast.success(`Hola, ${u.fullName.split(' ')[0]}`)
      nav('/admin', { replace: true })
    } catch (err) {
      toast.error(err.message || 'No se pudo iniciar sesión')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen relative overflow-hidden flex items-center justify-center px-4 py-10">
      <motion.div
        aria-hidden
        className="absolute -top-40 -left-40 w-[600px] h-[600px] rounded-full"
        style={{
          background: 'radial-gradient(circle, rgba(232,232,232,0.18), transparent 60%)',
        }}
        animate={{ x: [0, 40, 0], y: [0, 30, 0] }}
        transition={{ duration: 14, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        aria-hidden
        className="absolute -bottom-40 -right-40 w-[600px] h-[600px] rounded-full"
        style={{
          background: 'radial-gradient(circle, rgba(200,200,200,0.12), transparent 60%)',
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
          <p className="mt-3 text-[10px] uppercase tracking-[0.4em] text-nina-mute">
            Multi-Agent CRM
          </p>
        </div>

        <form onSubmit={submit} className="space-y-5">
          <div>
            <label className="label">Email</label>
            <div className="relative">
              <AtSign className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-nina-mute" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@correo.com"
                className="input pl-10"
                autoComplete="email"
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
      </motion.div>

      <div className="absolute bottom-6 text-[10px] uppercase tracking-[0.4em] text-nina-mute/60">
        Mentex · Holding
      </div>
    </div>
  )
}
