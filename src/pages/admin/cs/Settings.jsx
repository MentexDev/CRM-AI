// Módulo Configuración — etapas del pipeline (Kanban), PERSONALIZABLES por marca.
// Crear / renombrar / recolorear / reordenar (subir-bajar) / eliminar. Las columnas del Pipeline
// salen de aquí. Al eliminar una etapa, sus leads quedan "sin etapa" (FK on delete set null).
import { useCallback, useEffect, useState } from 'react'
import { GripVertical, Loader2, Plus, Trash2, ChevronUp, ChevronDown } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '../../../lib/supabase'
import Modal from '../../../components/Modal'
import { CsShell, useCsBrand } from './CsShell'

const PALETTE = ['#3b82f6', '#f59e0b', '#8b5cf6', '#22c55e', '#ef4444', '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#64748b']

export default function CsSettings() {
  const { brands, brandId, setBrandId } = useCsBrand()
  const [stages, setStages] = useState([])
  const [loading, setLoading] = useState(true)
  const [confirmDel, setConfirmDel] = useState(null)

  const load = useCallback(async () => {
    if (!brandId) { setStages([]); setLoading(false); return }
    setLoading(true)
    const { data, error } = await supabase
      .from('cs_stages')
      .select('id, name, color, position')
      .eq('brand_id', brandId)
      .order('position', { ascending: true })
    if (error) toast.error('No pude cargar las etapas: ' + error.message)
    setStages(data ?? [])
    setLoading(false)
  }, [brandId])

  useEffect(() => { load() }, [load])

  const addStage = async () => {
    const pos = stages.length ? Math.max(...stages.map((s) => s.position)) + 1 : 0
    const color = PALETTE[stages.length % PALETTE.length]
    const { error } = await supabase.from('cs_stages').insert({ brand_id: brandId, name: 'Nueva etapa', color, position: pos })
    if (error) toast.error(error.message); else load()
  }

  const patch = async (id, fields) => {
    setStages((prev) => prev.map((s) => (s.id === id ? { ...s, ...fields } : s)))
    const { error } = await supabase.from('cs_stages').update(fields).eq('id', id)
    if (error) { toast.error(error.message); load() }
  }

  // Reordenar: intercambia la posición con el vecino (arriba/abajo).
  const move = async (idx, dir) => {
    const j = idx + dir
    if (j < 0 || j >= stages.length) return
    const a = stages[idx], b = stages[j]
    setStages((prev) => { const n = [...prev];[n[idx], n[j]] = [n[j], n[idx]]; return n })
    await Promise.all([
      supabase.from('cs_stages').update({ position: b.position }).eq('id', a.id),
      supabase.from('cs_stages').update({ position: a.position }).eq('id', b.id),
    ])
    load()
  }

  const del = async () => {
    if (!confirmDel) return
    const { error } = await supabase.from('cs_stages').delete().eq('id', confirmDel.id)
    if (error) toast.error(error.message); else toast.success('Etapa eliminada')
    setConfirmDel(null)
    load()
  }

  return (
    <CsShell
      title="Configuración"
      subtitle="Las etapas del pipeline (columnas del Kanban) de este workspace."
      brands={brands}
      brandId={brandId}
      onBrand={setBrandId}
      actions={<button onClick={addStage} disabled={!brandId} className="btn-primary !py-2 !px-3 text-[13px] disabled:opacity-40"><Plus className="w-4 h-4" /> Agregar etapa</button>}
    >
      <div className="mb-3 text-[12px] uppercase tracking-[0.15em] text-nina-mute">Etapas del pipeline</div>
      {loading ? (
        <div className="flex items-center justify-center py-16 text-nina-mute"><Loader2 className="w-5 h-5 animate-spin" /></div>
      ) : (
        <div className="space-y-2 max-w-2xl">
          {stages.map((s, i) => (
            <div key={s.id} className="flex items-center gap-3 rounded-xl border border-nina-line bg-nina-panel/60 px-3 py-2.5">
              <GripVertical className="w-4 h-4 text-nina-mute/50 shrink-0" />
              <label className="relative shrink-0 cursor-pointer" title="Color de la etapa">
                <span className="block w-5 h-5 rounded-full border border-white/20" style={{ background: s.color }} />
                <input type="color" value={s.color} onChange={(e) => patch(s.id, { color: e.target.value })} className="absolute inset-0 opacity-0 cursor-pointer" />
              </label>
              <input
                value={s.name}
                onChange={(e) => setStages((prev) => prev.map((x) => (x.id === s.id ? { ...x, name: e.target.value } : x)))}
                onBlur={(e) => patch(s.id, { name: e.target.value.trim() || 'Etapa' })}
                className="flex-1 min-w-0 bg-transparent text-[14px] text-nina-chrome outline-none"
              />
              <div className="flex items-center gap-0.5 shrink-0">
                <button onClick={() => move(i, -1)} disabled={i === 0} className="w-7 h-7 grid place-items-center rounded text-nina-mute hover:text-nina-chrome hover:bg-nina-line/40 disabled:opacity-25" title="Subir"><ChevronUp className="w-4 h-4" /></button>
                <button onClick={() => move(i, 1)} disabled={i === stages.length - 1} className="w-7 h-7 grid place-items-center rounded text-nina-mute hover:text-nina-chrome hover:bg-nina-line/40 disabled:opacity-25" title="Bajar"><ChevronDown className="w-4 h-4" /></button>
                <button onClick={() => setConfirmDel(s)} className="w-7 h-7 grid place-items-center rounded text-nina-mute hover:text-red-300 hover:bg-nina-line/40" title="Eliminar"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
          ))}
          {stages.length === 0 && <div className="text-[13px] text-nina-mute py-6">No hay etapas. Agrega la primera.</div>}
        </div>
      )}

      <Modal open={!!confirmDel} onClose={() => setConfirmDel(null)} title="Eliminar etapa" maxWidth="max-w-sm">
        <p className="text-[13px] text-nina-mute mb-5">¿Eliminar la etapa <span className="text-nina-chrome">{confirmDel?.name}</span>? Los leads que estén ahí quedarán sin etapa (no se borran).</p>
        <div className="flex justify-end gap-2">
          <button onClick={() => setConfirmDel(null)} className="btn-ghost text-sm">Cancelar</button>
          <button onClick={del} className="btn !bg-red-500/90 hover:!bg-red-500 text-white text-sm">Eliminar</button>
        </div>
      </Modal>
    </CsShell>
  )
}
