import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  AtSign,
  Copy,
  Eye,
  EyeOff,
  Pencil,
  Plus,
  Target,
  Trash2,
  UserPlus2,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '../../context/AuthContext'
import { useData } from '../../context/DataContext'
import Modal from '../../components/Modal'
import ProgressBar from '../../components/ProgressBar'
import EmptyState from '../../components/EmptyState'
import { useConfirm } from '../../components/ConfirmDialog'
import { fmtCOP, fmtNumber } from '../../lib/format'
import { USERNAME_PREFIX, buildUsername, slug, DEFAULT_GOAL } from '../../lib/seed'

const emptyDraft = {
  firstName: '',
  lastName: '',
  password: 'nina2026',
  goal: DEFAULT_GOAL,
}

export default function Sellers() {
  const { listSellers, registerSeller, removeSeller, updateSeller } = useAuth()
  const { totalsBySeller } = useData()
  const confirm = useConfirm()
  const sellers = listSellers().filter((s) => s.role === 'seller')

  const [open, setOpen] = useState(false)
  const [editId, setEditId] = useState(null)
  const [draft, setDraft] = useState(emptyDraft)
  const [showPwd, setShowPwd] = useState(false)

  // Modal rápido para cambiar solo la meta
  const [goalModal, setGoalModal] = useState(null) // seller | null
  const [goalDraft, setGoalDraft] = useState(0)

  const previewUsername = useMemo(
    () => buildUsername(draft.firstName, draft.lastName),
    [draft.firstName, draft.lastName],
  )

  const openNew = () => {
    setEditId(null)
    setDraft(emptyDraft)
    setShowPwd(false)
    setOpen(true)
  }

  const openEdit = (s) => {
    setEditId(s.id)
    setDraft({
      firstName: s.firstName || s.name?.split(' ')[0] || '',
      lastName: s.lastName || s.name?.split(' ').slice(1).join(' ') || '',
      password: s.password || '',
      goal: s.goal || DEFAULT_GOAL,
    })
    setShowPwd(false)
    setOpen(true)
  }

  const save = async () => {
    try {
      if (editId) {
        await updateSeller(editId, {
          firstName: draft.firstName.trim(),
          lastName: draft.lastName.trim(),
          password: draft.password,
          goal: Number(draft.goal) || 0,
        })
        toast.success('Vendedora actualizada')
      } else {
        const u = await registerSeller({
          firstName: draft.firstName,
          lastName: draft.lastName,
          password: draft.password,
          goal: Number(draft.goal) || 0,
        })
        toast.success(`Cuenta creada · ${u.username}`)
      }
      setOpen(false)
    } catch (err) {
      toast.error(err.message)
    }
  }

  const del = async (s) => {
    const ok = await confirm({
      title: `¿Eliminar a ${s.name}?`,
      description: 'Sus ventas se conservan en el historial.',
      confirmText: 'Eliminar',
      variant: 'danger',
    })
    if (!ok) return
    try {
      await removeSeller(s.id)
      toast.success('Vendedora eliminada')
    } catch (err) {
      toast.error(err.message || 'No se pudo eliminar')
    }
  }

  const openGoal = (s) => {
    setGoalModal(s)
    setGoalDraft(s.goal || DEFAULT_GOAL)
  }

  const saveGoal = async () => {
    if (!goalModal) return
    const value = Number(goalDraft) || 0
    if (value < 0) return toast.error('La meta no puede ser negativa')
    try {
      await updateSeller(goalModal.id, { goal: value })
      toast.success(`Meta de ${goalModal.name.split(' ')[0]} actualizada a ${fmtCOP(value)}`)
      setGoalModal(null)
    } catch (err) {
      toast.error(err.message || 'No se pudo actualizar la meta')
    }
  }

  const copyUser = async (s) => {
    try {
      await navigator.clipboard.writeText(s.username)
      toast.success(`${s.username} copiado`)
    } catch {
      toast.error('No se pudo copiar')
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl silver-text">Vendedoras</h1>
          <p className="text-nina-mute text-sm mt-1">
            {sellers.length} cuentas activas para la feria. Los usuarios siempre llevan prefijo{' '}
            <span className="text-nina-chrome font-mono">{USERNAME_PREFIX}</span>.
          </p>
        </div>
        <button onClick={openNew} className="btn-primary">
          <UserPlus2 className="w-4 h-4" />
          Crear vendedora
        </button>
      </div>

      {sellers.length === 0 ? (
        <EmptyState
          icon={UserPlus2}
          title="Aún no hay vendedoras registradas"
          description="Si ya creaste vendedoras y no las ves, refresca la página (las suscripciones realtime pueden tardar unos segundos)."
          actions={
            <>
              <button onClick={openNew} className="btn-primary">
                <UserPlus2 className="w-4 h-4" />
                Crear vendedora
              </button>
              <button
                onClick={() => window.location.reload()}
                className="btn-ghost"
              >
                Refrescar
              </button>
            </>
          }
        />
      ) : (
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {sellers.map((s, i) => {
          const t = totalsBySeller[s.id] || { total: 0, units: 0, count: 0 }
          return (
            <motion.div
              key={s.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              className="panel panel-hover p-5"
            >
              <div className="flex items-start gap-3 mb-4">
                <div className="w-12 h-12 rounded-full grid place-items-center bg-silver-gradient text-nina-black font-bold text-sm shadow-chrome">
                  {s.avatar}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-display text-lg truncate">{s.name}</div>
                  <button
                    type="button"
                    onClick={() => copyUser(s)}
                    className="group flex items-center gap-1 text-xs text-nina-mute hover:text-nina-chrome transition truncate font-mono"
                    title="Copiar usuario"
                  >
                    <AtSign className="w-3 h-3 shrink-0" />
                    <span className="truncate">{s.username}</span>
                    <Copy className="w-3 h-3 opacity-0 group-hover:opacity-100 transition" />
                  </button>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => openEdit(s)} className="btn-ghost !p-2" title="Editar">
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button onClick={() => del(s)} className="btn-danger !p-2" title="Eliminar">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 mb-4 text-center">
                <div className="rounded-lg bg-nina-ink border border-nina-line py-2">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-nina-mute">Ventas</div>
                  <div className="silver-text font-semibold">{fmtNumber(t.count)}</div>
                </div>
                <div className="rounded-lg bg-nina-ink border border-nina-line py-2">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-nina-mute">Unid.</div>
                  <div className="silver-text font-semibold">{fmtNumber(t.units)}</div>
                </div>
                <div className="rounded-lg bg-nina-ink border border-nina-line py-2">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-nina-mute">Total</div>
                  <div className="silver-text font-semibold text-xs">{fmtCOP(t.total)}</div>
                </div>
              </div>

              <ProgressBar value={t.total} goal={s.goal || 1} />

              <button
                onClick={() => openGoal(s)}
                className="mt-3 w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-nina-line bg-nina-ink/60 hover:border-nina-silver/40 hover:bg-nina-ink transition text-xs group"
              >
                <span className="flex items-center gap-1.5 text-nina-mute group-hover:text-nina-chrome transition uppercase tracking-[0.18em]">
                  <Target className="w-3 h-3" />
                  Meta
                </span>
                <span className="silver-text font-semibold">{fmtCOP(s.goal || 0)}</span>
              </button>
            </motion.div>
          )
        })}
      </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editId ? 'Editar vendedora' : 'Crear vendedora'}
      >
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Nombre</label>
              <input
                className="input"
                value={draft.firstName}
                onChange={(e) => setDraft({ ...draft, firstName: e.target.value })}
                placeholder="Valentina"
                autoCapitalize="words"
              />
            </div>
            <div>
              <label className="label">Apellido</label>
              <input
                className="input"
                value={draft.lastName}
                onChange={(e) => setDraft({ ...draft, lastName: e.target.value })}
                placeholder="Ríos"
                autoCapitalize="words"
              />
            </div>
          </div>

          {/* Vista previa del usuario que se va a generar */}
          <div className="rounded-xl bg-nina-ink border border-nina-line p-4">
            <div className="text-[10px] uppercase tracking-[0.25em] text-nina-mute mb-1.5">
              Usuario que se generará
            </div>
            <div className="flex items-center gap-2 font-mono">
              <span className="silver-text font-bold tracking-wider">{USERNAME_PREFIX}</span>
              <span className="text-nina-chrome">
                {slug(draft.firstName) || 'nombre'}.
                {slug(draft.lastName) || 'apellido'}
              </span>
            </div>
            <p className="text-[11px] text-nina-mute mt-2">
              Este es el usuario con el que iniciará sesión.
            </p>
          </div>

          <div>
            <label className="label">Contraseña</label>
            <div className="relative">
              <input
                type={showPwd ? 'text' : 'password'}
                className="input pr-10"
                value={draft.password}
                onChange={(e) => setDraft({ ...draft, password: e.target.value })}
                placeholder="Mínimo 4 caracteres"
              />
              <button
                type="button"
                onClick={() => setShowPwd((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-nina-mute hover:text-nina-chrome"
              >
                {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="label">Meta de ventas (COP)</label>
            <input
              className="input"
              type="number"
              min="0"
              step="100000"
              value={draft.goal}
              onChange={(e) => setDraft({ ...draft, goal: e.target.value })}
            />
            <div className="flex flex-wrap gap-1.5 mt-2">
              {[1000000, 2000000, 3000000, 5000000, 10000000].map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setDraft({ ...draft, goal: g })}
                  className={`text-[11px] px-2 py-1 rounded-md border transition ${
                    Number(draft.goal) === g
                      ? 'bg-silver-gradient text-nina-black border-transparent'
                      : 'border-nina-line text-nina-mute hover:text-nina-chrome hover:border-nina-silver/40'
                  }`}
                >
                  {fmtCOP(g)}
                </button>
              ))}
            </div>
          </div>

          {!editId && previewUsername && (
            <div className="text-[11px] text-nina-mute leading-relaxed">
              Comparte estas credenciales con la vendedora:
              <div className="mt-1 font-mono text-nina-chrome">
                Usuario: {previewUsername}
                <br />
                Clave: {draft.password || '—'}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button onClick={() => setOpen(false)} className="btn-ghost">
            Cancelar
          </button>
          <button onClick={save} className="btn-primary">
            <Plus className="w-4 h-4" />
            {editId ? 'Guardar cambios' : 'Crear vendedora'}
          </button>
        </div>
      </Modal>

      <Modal
        open={!!goalModal}
        onClose={() => setGoalModal(null)}
        title={goalModal ? `Meta de ${goalModal.name}` : 'Meta'}
      >
        {goalModal && (
          <div className="space-y-5">
            <div className="rounded-xl bg-nina-ink border border-nina-line p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full grid place-items-center bg-silver-gradient text-nina-black font-bold text-sm shadow-chrome">
                  {goalModal.avatar}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] uppercase tracking-[0.25em] text-nina-mute">
                    Vendido / Meta actual
                  </div>
                  <div className="silver-text font-display text-lg font-bold">
                    {fmtCOP(totalsBySeller[goalModal.id]?.total || 0)}{' '}
                    <span className="text-nina-mute font-normal">/</span>{' '}
                    {fmtCOP(goalModal.goal || 0)}
                  </div>
                </div>
              </div>
            </div>

            <div>
              <label className="label">Nueva meta (COP)</label>
              <input
                className="input"
                type="number"
                min="0"
                step="100000"
                value={goalDraft}
                onChange={(e) => setGoalDraft(e.target.value)}
                autoFocus
              />
              <div className="flex flex-wrap gap-1.5 mt-2">
                {[1000000, 2000000, 3000000, 5000000, 10000000].map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setGoalDraft(g)}
                    className={`text-[11px] px-2.5 py-1 rounded-md border transition ${
                      Number(goalDraft) === g
                        ? 'bg-silver-gradient text-nina-black border-transparent'
                        : 'border-nina-line text-nina-mute hover:text-nina-chrome hover:border-nina-silver/40'
                    }`}
                  >
                    {fmtCOP(g)}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-nina-mute mt-2">
                La vendedora verá esta meta en su dashboard junto con su barra de progreso.
              </p>
            </div>

            <div className="flex justify-end gap-2">
              <button onClick={() => setGoalModal(null)} className="btn-ghost">
                Cancelar
              </button>
              <button onClick={saveGoal} className="btn-primary">
                <Target className="w-4 h-4" />
                Guardar meta
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
