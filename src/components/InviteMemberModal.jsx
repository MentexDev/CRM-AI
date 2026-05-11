import { useEffect, useState } from 'react'
import { AtSign, Loader2, Mail } from 'lucide-react'
import toast from 'react-hot-toast'
import Modal from './Modal'
import { supabase } from '../lib/supabase'
import { useBrands } from '../hooks/useBrands'

const GLOBAL_ROLES = [
  { value: 'viewer', label: 'Observador', description: 'Sólo lectura de marcas asignadas.' },
  { value: 'member', label: 'Miembro', description: 'Acceso normal a marcas asignadas.' },
  { value: 'admin', label: 'Administrador', description: 'Puede gestionar agentes y tareas de sus marcas.' },
  { value: 'junta', label: 'Junta Directiva', description: 'Acceso total. Aprueba decisiones críticas.' },
]

const BRAND_ROLES = [
  { value: 'viewer', label: 'Observador' },
  { value: 'member', label: 'Miembro' },
  { value: 'manager', label: 'Manager' },
  { value: 'admin', label: 'Admin de marca' },
]

export default function InviteMemberModal({ open, onClose }) {
  const { brands } = useBrands()
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState('member')
  const [brandRole, setBrandRole] = useState('member')
  const [brandIds, setBrandIds] = useState([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setEmail('')
    setFullName('')
    setRole('member')
    setBrandRole('member')
    setBrandIds([])
  }, [open])

  const toggleBrand = (id) => {
    setBrandIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const submit = async (e) => {
    e.preventDefault()
    if (!email.trim()) return toast.error('Pon un email')
    if (role !== 'junta' && brandIds.length === 0) {
      return toast.error('Asigna al menos una marca (o asciende el rol a Junta para acceso global)')
    }

    setBusy(true)
    try {
      const { data, error } = await supabase.functions.invoke('admin-invite', {
        body: {
          email: email.trim(),
          full_name: fullName.trim() || undefined,
          role,
          brand_role: brandRole,
          brand_ids: brandIds,
        },
      })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      toast.success(`Invitación enviada a ${email.trim()}`)
      onClose()
    } catch (err) {
      const msg = err?.message || String(err)
      toast.error(msg)
    } finally {
      setBusy(false)
    }
  }

  const isJuntaRole = role === 'junta'

  return (
    <Modal open={open} onClose={onClose} title="Invitar al equipo" maxWidth="max-w-xl">
      <form onSubmit={submit} className="space-y-5">
        <section className="space-y-3">
          <h4 className="text-xs uppercase tracking-[0.2em] text-nina-mute">Persona</h4>
          <div>
            <label className="label">Email *</label>
            <div className="relative">
              <AtSign className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-nina-mute" />
              <input
                type="email"
                className="input pl-10"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="persona@empresa.com"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoFocus
              />
            </div>
          </div>
          <div>
            <label className="label">Nombre completo (opcional)</label>
            <input
              className="input"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Ej: María Pérez"
            />
          </div>
        </section>

        <section className="space-y-3">
          <h4 className="text-xs uppercase tracking-[0.2em] text-nina-mute">Rol global</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {GLOBAL_ROLES.map((r) => {
              const checked = role === r.value
              return (
                <label
                  key={r.value}
                  className={`flex items-start gap-2 rounded-lg border p-2.5 cursor-pointer transition ${
                    checked
                      ? 'border-nina-silver/40 bg-nina-line/40'
                      : 'border-nina-line bg-nina-ink hover:border-nina-line'
                  }`}
                >
                  <input
                    type="radio"
                    name="role"
                    value={r.value}
                    checked={checked}
                    onChange={() => setRole(r.value)}
                    className="mt-0.5 accent-nina-silver"
                  />
                  <div className="min-w-0">
                    <div className="text-[12px] font-medium text-nina-chrome">{r.label}</div>
                    <div className="text-[11px] text-nina-mute leading-snug mt-0.5">
                      {r.description}
                    </div>
                  </div>
                </label>
              )
            })}
          </div>
        </section>

        {!isJuntaRole && (
          <section className="space-y-3">
            <h4 className="text-xs uppercase tracking-[0.2em] text-nina-mute">Marcas asignadas *</h4>
            {brands.length === 0 ? (
              <div className="text-[12px] text-nina-mute italic">
                No hay marcas creadas todavía. Crea una en la pestaña de Marcas o asciende a Junta Directiva para acceso global.
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {brands.map((b) => {
                    const checked = brandIds.includes(b.id)
                    return (
                      <label
                        key={b.id}
                        className={`flex items-center gap-2 rounded-lg border p-2.5 cursor-pointer transition ${
                          checked
                            ? 'border-nina-silver/40 bg-nina-line/40'
                            : 'border-nina-line bg-nina-ink hover:border-nina-line'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleBrand(b.id)}
                          className="accent-nina-silver"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-[12px] text-nina-chrome truncate">{b.name}</div>
                          <div className="text-[10px] text-nina-mute font-mono truncate">{b.slug}</div>
                        </div>
                      </label>
                    )
                  })}
                </div>
                <div>
                  <label className="label">Rol dentro de cada marca</label>
                  <select
                    className="input"
                    value={brandRole}
                    onChange={(e) => setBrandRole(e.target.value)}
                  >
                    {BRAND_ROLES.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}
          </section>
        )}

        <div className="rounded-lg border border-nina-line bg-nina-ink/60 p-3 flex items-start gap-2 text-[11px] text-nina-mute">
          <Mail className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <p>
            La persona recibirá un email con un enlace mágico. Al hacer click y crear su contraseña,
            quedará automáticamente con el rol y las marcas asignadas.
          </p>
        </div>

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-3 border-t border-nina-line">
          <button type="button" onClick={onClose} className="btn-ghost" disabled={busy}>
            Cancelar
          </button>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Enviando…
              </>
            ) : (
              'Enviar invitación'
            )}
          </button>
        </div>
      </form>
    </Modal>
  )
}
