import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { Check, Copy, KeyRound, LogOut, Trash2, User, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '../context/AuthContext'
import { useConfirm } from './ConfirmDialog'
import { supabase } from '../lib/supabase'

export default function SettingsModal({ open, onClose }) {
  const { user, logout } = useAuth()
  const nav = useNavigate()
  const confirm = useConfirm()

  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)
  const [copied, setCopied] = useState(false)

  // Cambio de contraseña
  const [pwOpen, setPwOpen] = useState(false)
  const [pw1, setPw1] = useState('')
  const [pw2, setPw2] = useState('')
  const [savingPw, setSavingPw] = useState(false)

  useEffect(() => {
    if (!open || !user) return
    setFullName(user.fullName || '')
    setCopied(false)
    setPwOpen(false)
    setPw1('')
    setPw2('')
    // Cargar teléfono desde profiles
    let active = true
    supabase
      .from('profiles')
      .select('phone')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => active && setPhone(data?.phone || ''))
    return () => {
      active = false
    }
  }, [open, user])

  if (!user) return null

  const saveProfile = async () => {
    setSavingProfile(true)
    const { error } = await supabase
      .from('profiles')
      .update({ full_name: fullName.trim() || null, phone: phone.trim() || null })
      .eq('id', user.id)
    setSavingProfile(false)
    if (error) toast.error('No se pudieron guardar los cambios')
    else toast.success('Perfil actualizado')
  }

  const changePassword = async () => {
    if (pw1.length < 6) {
      toast.error('La contraseña debe tener al menos 6 caracteres')
      return
    }
    if (pw1 !== pw2) {
      toast.error('Las contraseñas no coinciden')
      return
    }
    setSavingPw(true)
    const { error } = await supabase.auth.updateUser({ password: pw1 })
    setSavingPw(false)
    if (error) {
      toast.error(error.message || 'No se pudo cambiar la contraseña')
      return
    }
    toast.success('Contraseña actualizada')
    setPwOpen(false)
    setPw1('')
    setPw2('')
  }

  const handleLogout = async () => {
    const ok = await confirm({
      title: 'Cerrar sesión',
      description: 'Se cerrará tu sesión en este dispositivo. ¿Continuar?',
      confirmText: 'Cerrar sesión',
    })
    if (!ok) return
    await logout()
    nav('/login', { replace: true })
  }

  const handleDelete = async () => {
    const ok = await confirm({
      title: '¿Eliminar tu cuenta?',
      description:
        'Esta acción es permanente. Por seguridad, la eliminación de cuentas la procesa un administrador del holding. ¿Quieres enviar la solicitud?',
      confirmText: 'Solicitar eliminación',
      variant: 'danger',
    })
    if (!ok) return
    toast('Solicitud enviada al administrador del holding', { icon: '📨' })
  }

  const copyOrgId = async () => {
    try {
      await navigator.clipboard.writeText(user.id)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('No se pudo copiar')
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="relative panel w-full max-w-3xl max-h-[88vh] flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="px-5 py-4 border-b border-nina-line flex items-center justify-between shrink-0">
              <h3 className="font-display text-xl silver-text">Ajustes</h3>
              <button onClick={onClose} className="btn-ghost !p-2" aria-label="Cerrar">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 min-h-0 flex">
              {/* Nav lateral */}
              <div className="hidden sm:flex flex-col w-44 shrink-0 border-r border-nina-line p-2">
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-nina-line/40 text-nina-chrome text-sm">
                  <User className="w-4 h-4" />
                  Cuenta
                </div>
                <div className="mt-auto px-3 py-2 leading-relaxed">
                  <div className="text-[10px] uppercase tracking-[0.2em] text-nina-mute/70">
                    Mentex Holding
                  </div>
                  <div className="text-[11px] text-nina-mute/70 mt-0.5">v0.2 · Multi-Agent CRM</div>
                </div>
              </div>

              {/* Contenido */}
              <div className="flex-1 min-w-0 overflow-y-auto px-5 sm:px-6 py-5 space-y-7">
                {/* Perfil */}
                <section className="space-y-3">
                  <h4 className="text-[11px] uppercase tracking-[0.2em] text-nina-mute">Perfil</h4>
                  <Field label="Nombre">
                    <input
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      className="input"
                      placeholder="Tu nombre"
                    />
                  </Field>
                  <Field label="Correo">
                    <div className="input !bg-nina-ink/60 text-nina-mute select-text">{user.email}</div>
                  </Field>
                  <Field label="Teléfono">
                    <input
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="input"
                      placeholder="+57 ..."
                      type="tel"
                    />
                  </Field>
                  <div className="flex justify-end">
                    <button onClick={saveProfile} disabled={savingProfile} className="btn-primary text-sm">
                      {savingProfile ? 'Guardando…' : 'Guardar cambios'}
                    </button>
                  </div>
                </section>

                {/* Seguridad */}
                <section className="space-y-3">
                  <h4 className="text-[11px] uppercase tracking-[0.2em] text-nina-mute">Seguridad</h4>
                  <Row
                    title="Contraseña"
                    desc="Cambia la contraseña de tu cuenta."
                    action={
                      <button
                        onClick={() => setPwOpen((v) => !v)}
                        className="btn-ghost !py-1.5 !px-3 text-xs flex items-center gap-1.5"
                      >
                        <KeyRound className="w-3.5 h-3.5" />
                        Cambiar contraseña
                      </button>
                    }
                  />
                  {pwOpen && (
                    <div className="rounded-xl border border-nina-line bg-nina-ink/40 p-3 space-y-3">
                      <input
                        type="password"
                        value={pw1}
                        onChange={(e) => setPw1(e.target.value)}
                        className="input"
                        placeholder="Nueva contraseña (mín. 6 caracteres)"
                      />
                      <input
                        type="password"
                        value={pw2}
                        onChange={(e) => setPw2(e.target.value)}
                        className="input"
                        placeholder="Confirmar nueva contraseña"
                      />
                      <div className="flex justify-end gap-2">
                        <button onClick={() => setPwOpen(false)} className="btn-ghost text-xs">
                          Cancelar
                        </button>
                        <button onClick={changePassword} disabled={savingPw} className="btn-primary text-xs">
                          {savingPw ? 'Guardando…' : 'Actualizar contraseña'}
                        </button>
                      </div>
                    </div>
                  )}
                </section>

                {/* Organización */}
                <section className="space-y-3">
                  <h4 className="text-[11px] uppercase tracking-[0.2em] text-nina-mute">Organización</h4>
                  <Row
                    title="ID de organización"
                    desc={user.id}
                    descMono
                    action={
                      <button
                        onClick={copyOrgId}
                        className="btn-ghost !py-1.5 !px-3 text-xs flex items-center gap-1.5"
                      >
                        {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        {copied ? 'Copiado' : 'Copiar'}
                      </button>
                    }
                  />
                </section>

                {/* Sesión */}
                <section className="space-y-3">
                  <h4 className="text-[11px] uppercase tracking-[0.2em] text-nina-mute">Sesión</h4>
                  <Row
                    title="Cerrar sesión"
                    desc="Cierra tu sesión en este dispositivo."
                    action={
                      <button
                        onClick={handleLogout}
                        className="btn-ghost !py-1.5 !px-3 text-xs flex items-center gap-1.5"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                        Cerrar sesión
                      </button>
                    }
                  />
                  <Row
                    title="Eliminar cuenta"
                    desc="Elimina permanentemente tu cuenta del holding."
                    action={
                      <button
                        onClick={handleDelete}
                        className="!py-1.5 !px-3 text-xs flex items-center gap-1.5 rounded-lg border border-red-500/30 text-red-300 hover:bg-red-500/10 transition"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Eliminar cuenta
                      </button>
                    }
                  />
                </section>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <label className="text-[12px] text-nina-mute mb-1 block">{label}</label>
      {children}
    </div>
  )
}

function Row({ title, desc, descMono, action }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <div className="min-w-0">
        <div className="text-sm text-nina-chrome">{title}</div>
        <div className={`text-[11px] text-nina-mute truncate ${descMono ? 'font-mono' : ''}`}>{desc}</div>
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  )
}
