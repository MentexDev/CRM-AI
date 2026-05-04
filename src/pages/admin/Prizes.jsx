import { useState } from 'react'
import { motion } from 'framer-motion'
import { Banknote, Pencil, Plus, RotateCcw, ShoppingBag, Trash2, Trophy } from 'lucide-react'
import toast from 'react-hot-toast'
import { useData } from '../../context/DataContext'
import Modal from '../../components/Modal'
import { fmtPrizeThreshold } from '../../lib/format'

const ICON_PRESETS = ['🎁', '🌟', '👗', '💎', '👑', '🏆', '✨', '💝', '🎀', '💄', '👜', '👠']

const empty = { id: '', type: 'amount', threshold: 1000000, name: '', icon: '🎁' }

export default function Prizes() {
  const { prizes, upsertPrize, removePrize, resetPrizes } = useData()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(empty)
  const [editing, setEditing] = useState(false)

  const openNew = () => {
    setDraft({ ...empty, id: `pz-${Date.now()}` })
    setEditing(false)
    setOpen(true)
  }

  const openEdit = (p) => {
    setDraft({ type: 'amount', ...p })
    setEditing(true)
    setOpen(true)
  }

  const save = () => {
    if (!draft.name.trim()) return toast.error('El nombre del premio es obligatorio')
    const threshold = Number(draft.threshold)
    if (!threshold || threshold <= 0) return toast.error('La meta debe ser mayor a 0')
    if (!draft.icon) return toast.error('Selecciona un ícono')
    upsertPrize({
      id: draft.id || `pz-${Date.now()}`,
      type: draft.type === 'units' ? 'units' : 'amount',
      name: draft.name.trim(),
      threshold,
      icon: draft.icon,
    })
    toast.success(editing ? 'Premio actualizado' : 'Premio creado')
    setOpen(false)
  }

  const del = (p) => {
    if (!confirm(`¿Eliminar el premio "${p.name}"?`)) return
    removePrize(p.id)
    toast.success('Premio eliminado')
  }

  const reset = () => {
    if (!confirm('¿Restaurar los premios por defecto? Se reemplazarán los actuales.')) return
    resetPrizes()
    toast.success('Premios restaurados')
  }

  const sorted = [...prizes].sort((a, b) => {
    const ta = a.type || 'amount'
    const tb = b.type || 'amount'
    if (ta !== tb) return ta === 'amount' ? -1 : 1
    return Number(a.threshold) - Number(b.threshold)
  })

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl silver-text">Premios</h1>
          <p className="text-nina-mute text-sm mt-1">
            Define las metas y recompensas que motivan al equipo NINA. {prizes.length} premios
            activos.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={reset} className="btn-ghost" title="Restaurar premios por defecto">
            <RotateCcw className="w-4 h-4" />
            Restaurar
          </button>
          <button onClick={openNew} className="btn-primary">
            <Plus className="w-4 h-4" />
            Nuevo premio
          </button>
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="panel p-10 text-center">
          <Trophy className="w-8 h-8 mx-auto mb-3 text-nina-mute opacity-60" />
          <p className="text-nina-mute text-sm mb-4">
            Todavía no hay premios configurados. Crea el primero para motivar a tus vendedoras.
          </p>
          <button onClick={openNew} className="btn-primary">
            <Plus className="w-4 h-4" />
            Crear premio
          </button>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {sorted.map((p, i) => (
            <motion.div
              key={p.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              className="panel panel-hover p-5 relative overflow-hidden"
            >
              <div
                aria-hidden
                className="absolute -top-16 -right-16 w-40 h-40 rounded-full opacity-30 blur-3xl pointer-events-none"
                style={{
                  background:
                    'radial-gradient(circle, rgba(232,232,232,0.25), transparent 70%)',
                }}
              />
              <div className="relative">
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div className="text-4xl animate-float">{p.icon}</div>
                  <div className="flex gap-1">
                    <button onClick={() => openEdit(p)} className="btn-ghost !p-2">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button onClick={() => del(p)} className="btn-danger !p-2">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <span
                  className={`chip mb-2 ${
                    (p.type || 'amount') === 'units'
                      ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
                      : 'border-nina-line bg-nina-line/40 text-nina-silver'
                  }`}
                >
                  {(p.type || 'amount') === 'units' ? (
                    <>
                      <ShoppingBag className="w-3 h-3" /> Por unidades
                    </>
                  ) : (
                    <>
                      <Banknote className="w-3 h-3" /> Por monto
                    </>
                  )}
                </span>
                <div className="text-[10px] uppercase tracking-[0.25em] text-nina-mute mb-1">
                  {(p.type || 'amount') === 'units' ? 'Al vender' : 'Al alcanzar'}
                </div>
                <div className="silver-text font-display text-2xl font-bold mb-3">
                  {fmtPrizeThreshold(p)}
                </div>
                <div className="border-t border-nina-line pt-3">
                  <div className="text-[10px] uppercase tracking-[0.2em] text-nina-mute mb-1">
                    Premio
                  </div>
                  <div className="font-medium text-nina-chrome">{p.name}</div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Editar premio' : 'Nuevo premio'}
      >
        <div className="space-y-5">
          <div className="flex items-center justify-between p-4 rounded-xl bg-nina-ink border border-nina-line">
            <div>
              <div className="text-[11px] uppercase tracking-[0.2em] text-nina-mute">
                Vista previa
              </div>
              <div className="font-medium text-nina-chrome mt-1">
                {draft.name || 'Nombre del premio'}
              </div>
              <div className="text-xs text-nina-mute">
                {draft.type === 'units' ? 'Al vender' : 'Al alcanzar'}{' '}
                {fmtPrizeThreshold({
                  type: draft.type,
                  threshold: Number(draft.threshold) || 0,
                })}
              </div>
            </div>
            <div className="text-5xl">{draft.icon}</div>
          </div>

          <div>
            <label className="label">Tipo de meta</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setDraft({ ...draft, type: 'amount' })}
                className={`flex items-center gap-2 justify-center py-3 px-3 rounded-xl border transition ${
                  draft.type !== 'units'
                    ? 'bg-silver-gradient text-nina-black border-transparent shadow-chrome'
                    : 'bg-nina-ink border-nina-line text-nina-chrome hover:border-nina-silver/40'
                }`}
              >
                <Banknote className="w-4 h-4" />
                <div className="text-left leading-tight">
                  <div className="font-semibold text-sm">Por monto</div>
                  <div className="text-[10px] opacity-80">Ventas en COP</div>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setDraft({ ...draft, type: 'units' })}
                className={`flex items-center gap-2 justify-center py-3 px-3 rounded-xl border transition ${
                  draft.type === 'units'
                    ? 'bg-silver-gradient text-nina-black border-transparent shadow-chrome'
                    : 'bg-nina-ink border-nina-line text-nina-chrome hover:border-nina-silver/40'
                }`}
              >
                <ShoppingBag className="w-4 h-4" />
                <div className="text-left leading-tight">
                  <div className="font-semibold text-sm">Por unidades</div>
                  <div className="text-[10px] opacity-80">Prendas vendidas</div>
                </div>
              </button>
            </div>
          </div>

          <div>
            <label className="label">Nombre del premio</label>
            <input
              className="input"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Ej: Bono COP $50.000"
            />
          </div>

          <div>
            <label className="label">
              {draft.type === 'units' ? 'Meta en unidades vendidas' : 'Meta de ventas (COP)'}
            </label>
            <div className="relative">
              <input
                type="number"
                min="0"
                step={draft.type === 'units' ? 1 : 1000}
                className="input pr-20"
                value={draft.threshold}
                onChange={(e) => setDraft({ ...draft, threshold: e.target.value })}
                placeholder={draft.type === 'units' ? '15' : '1000000'}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] uppercase tracking-[0.18em] text-nina-mute">
                {draft.type === 'units' ? 'unid.' : 'COP'}
              </span>
            </div>
            <p className="text-[11px] text-nina-mute mt-1.5">
              {draft.type === 'units'
                ? 'La vendedora desbloquea este premio cuando haya vendido esta cantidad de prendas.'
                : 'La vendedora desbloquea este premio cuando sus ventas alcancen este monto.'}
            </p>
          </div>

          <div>
            <label className="label">Ícono</label>
            <div className="grid grid-cols-6 gap-2">
              {ICON_PRESETS.map((ic) => (
                <button
                  key={ic}
                  type="button"
                  onClick={() => setDraft({ ...draft, icon: ic })}
                  className={`text-2xl py-2 rounded-xl border transition ${
                    draft.icon === ic
                      ? 'bg-silver-gradient border-transparent shadow-chrome'
                      : 'bg-nina-ink border-nina-line hover:border-nina-silver/40'
                  }`}
                >
                  {ic}
                </button>
              ))}
            </div>
            <input
              className="input mt-2"
              value={draft.icon}
              onChange={(e) => setDraft({ ...draft, icon: e.target.value })}
              placeholder="O escribe tu propio emoji"
              maxLength={4}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setOpen(false)} className="btn-ghost">
              Cancelar
            </button>
            <button onClick={save} className="btn-primary">
              {editing ? 'Guardar cambios' : 'Crear premio'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
