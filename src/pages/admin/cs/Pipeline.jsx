// Módulo Pipeline — el tablero Kanban de leads por etapa. Arrastrar leads entre etapas (drag-and-drop
// NATIVO HTML5, sin librerías). Las columnas salen de cs_stages (personalizables en Configuración);
// los leads de cs_leads (un lead = un contacto en una etapa). Tiempo real. Diseño NINA.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Plus } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '../../../lib/supabase'
import Modal from '../../../components/Modal'
import { normPhone, useCsBrand } from './CsShell'

export default function CsPipeline() {
  const { brands, brandId, setBrandId } = useCsBrand()
  const [stages, setStages] = useState([])
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [overStage, setOverStage] = useState(null)
  const [addTo, setAddTo] = useState(null) // etapa destino para "nuevo lead"
  const dragId = useRef(null)

  const load = useCallback(async () => {
    if (!brandId) { setStages([]); setLeads([]); setLoading(false); return }
    setLoading(true)
    const [{ data: st }, { data: ld }] = await Promise.all([
      supabase.from('cs_stages').select('id, name, color, position').eq('brand_id', brandId).order('position', { ascending: true }),
      supabase.from('cs_leads').select('id, stage_id, status, position, created_at, cs_contacts!inner(id, name, phone, tags)').eq('brand_id', brandId).order('position', { ascending: true }).order('created_at', { ascending: true }),
    ])
    setStages(st ?? [])
    setLeads(ld ?? [])
    setLoading(false)
  }, [brandId])

  useEffect(() => { load() }, [load])
  // Tiempo real: leads + etapas de la marca.
  useEffect(() => {
    if (!brandId) return
    const ch = supabase.channel(`cs_pipeline-${brandId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cs_leads', filter: `brand_id=eq.${brandId}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cs_stages', filter: `brand_id=eq.${brandId}` }, load)
      .subscribe()
    return () => { try { supabase.removeChannel(ch) } catch { /* */ } }
  }, [brandId, load])

  const moveLead = async (leadId, stageId) => {
    const lead = leads.find((l) => l.id === leadId)
    if (!lead || lead.stage_id === stageId) return
    // Posición = al final de la etapa destino (persistida → el orden se conserva tras recargar).
    const pos = Math.max(0, ...leads.filter((l) => l.stage_id === stageId).map((l) => l.position ?? 0)) + 1
    setLeads((prev) => prev.map((l) => (l.id === leadId ? { ...l, stage_id: stageId, position: pos } : l))) // optimista
    const { error } = await supabase.from('cs_leads').update({ stage_id: stageId, position: pos, updated_at: new Date().toISOString() }).eq('id', leadId)
    if (error) { toast.error(error.message); load() }
  }

  const onDrop = (stageId) => { const id = dragId.current; dragId.current = null; setOverStage(null); if (id) moveLead(id, stageId) }

  // Crear lead (contacto + lead) en una etapa.
  const createLead = async ({ name, phone }) => {
    const ph = normPhone(phone)
    if (!ph) { toast.error('El número es obligatorio'); return }
    const { data: u } = await supabase.auth.getUser()
    const { data: c, error } = await supabase.from('cs_contacts').insert({ brand_id: brandId, name: (name || '').trim() || null, phone: ph, created_by: u?.user?.id ?? null }).select('id').single()
    let contactId = c?.id
    if (error) {
      if (error.code === '23505') { // contacto ya existe → reusar
        const { data: ex } = await supabase.from('cs_contacts').select('id').eq('brand_id', brandId).eq('phone', ph).maybeSingle()
        contactId = ex?.id
      } else { toast.error(error.message); return }
    }
    if (!contactId) { toast.error('No pude crear el contacto'); return }
    const { error: e2 } = await supabase.from('cs_leads').insert({ brand_id: brandId, contact_id: contactId, stage_id: addTo, created_by: u?.user?.id ?? null })
    if (e2) { toast.error(e2.message); return }
    toast.success('Lead agregado')
    setAddTo(null)
    load()
  }

  const byStage = (id) => leads.filter((l) => l.stage_id === id)
  const unstaged = leads.filter((l) => !l.stage_id)

  return (
    <div className="h-full flex flex-col">
      <div className="px-5 sm:px-7 pt-6 pb-4 flex items-start justify-between gap-4 flex-wrap shrink-0">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-nina-chrome">Pipeline</h1>
          <p className="text-[13px] text-nina-mute mt-1">Arrastra los leads entre etapas. {leads.length} lead{leads.length !== 1 ? 's' : ''}.</p>
        </div>
        {brands.length > 1 && (
          <select value={brandId} onChange={(e) => setBrandId(e.target.value)} className="bg-nina-ink border border-nina-line rounded-lg px-3 py-2 text-[13px] text-nina-chrome outline-none focus:border-nina-silver/40">
            {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-nina-mute"><Loader2 className="w-5 h-5 animate-spin" /></div>
      ) : stages.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-center px-6">
          <div>
            <div className="text-[15px] font-semibold text-nina-chrome mb-1">No hay etapas todavía</div>
            <div className="text-[12.5px] text-nina-mute">Crea las etapas del pipeline en <span className="text-nina-chrome">Configuración</span>.</div>
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-x-auto px-5 sm:px-7 pb-5">
          <div className="flex gap-3 h-full min-w-max">
            {stages.map((s) => (
              <Column
                key={s.id}
                stage={s}
                leads={byStage(s.id)}
                over={overStage === s.id}
                onDragOver={(e) => { e.preventDefault(); setOverStage(s.id) }}
                onDragLeave={() => setOverStage((o) => (o === s.id ? null : o))}
                onDrop={() => onDrop(s.id)}
                onDragStartCard={(id) => { dragId.current = id }}
                onAdd={() => setAddTo(s.id)}
              />
            ))}
            {unstaged.length > 0 && (
              <Column stage={{ id: null, name: 'Sin etapa', color: '#64748b' }} leads={unstaged}
                over={overStage === '__none'} onDragOver={(e) => { e.preventDefault(); setOverStage('__none') }}
                onDragLeave={() => setOverStage((o) => (o === '__none' ? null : o))} onDrop={() => onDrop(null)}
                onDragStartCard={(id) => { dragId.current = id }} onAdd={null} />
            )}
          </div>
        </div>
      )}

      <Modal open={!!addTo} onClose={() => setAddTo(null)} title="Nuevo lead" maxWidth="max-w-md">
        {addTo && <QuickLeadForm onSave={createLead} onCancel={() => setAddTo(null)} />}
      </Modal>
    </div>
  )
}

function Column({ stage, leads, over, onDragOver, onDragLeave, onDrop, onDragStartCard, onAdd }) {
  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`w-72 shrink-0 flex flex-col rounded-2xl border bg-nina-panel/40 transition ${over ? 'border-nina-silver/60 bg-nina-panel/70' : 'border-nina-line/60'}`}
    >
      <div className="flex items-center gap-2 px-3 py-2.5 shrink-0">
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: stage.color }} />
        <span className="text-[13px] font-semibold text-nina-chrome truncate flex-1">{stage.name}</span>
        <span className="text-[11px] text-nina-mute px-1.5 py-0.5 rounded-full bg-nina-line/50">{leads.length}</span>
        {onAdd && <button onClick={onAdd} title="Nuevo lead" className="w-6 h-6 grid place-items-center rounded text-nina-mute hover:text-nina-chrome hover:bg-nina-line/40"><Plus className="w-4 h-4" /></button>}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2 space-y-2">
        {leads.map((l) => <LeadCard key={l.id} lead={l} onDragStart={() => onDragStartCard(l.id)} />)}
        {leads.length === 0 && <div className="text-[11.5px] text-nina-mute/60 text-center py-6">Vacío</div>}
      </div>
    </div>
  )
}

function LeadCard({ lead, onDragStart }) {
  const c = lead.cs_contacts || {}
  const initial = (c.name || c.phone || '?').trim().charAt(0).toUpperCase()
  return (
    <div
      draggable
      onDragStart={onDragStart}
      className="rounded-xl border border-nina-line bg-nina-ink px-3 py-2.5 cursor-grab active:cursor-grabbing hover:border-nina-silver/40 transition"
    >
      <div className="flex items-center gap-2.5">
        <span className="w-8 h-8 grid place-items-center rounded-full bg-silver-gradient text-nina-black text-[12px] font-semibold shrink-0">{initial}</span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-nina-chrome truncate">{c.name || c.phone}</div>
          <div className="text-[11px] text-nina-mute truncate">{c.phone}</div>
        </div>
      </div>
      {(c.tags || []).length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {c.tags.slice(0, 4).map((t) => <span key={t} className="text-[9.5px] px-1.5 py-0.5 rounded-full bg-nina-line/50 text-nina-silver">{t}</span>)}
        </div>
      )}
    </div>
  )
}

function QuickLeadForm({ onSave, onCancel }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e) => { e.preventDefault(); setBusy(true); await onSave({ name, phone }); setBusy(false) }
  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="label">Número de WhatsApp *</label>
        <input className="input font-mono text-[13px]" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+57 300 000 0000" autoFocus />
      </div>
      <div>
        <label className="label">Nombre</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre del cliente" />
      </div>
      <div className="flex justify-end gap-2 pt-2 border-t border-nina-line">
        <button type="button" onClick={onCancel} className="btn-ghost text-sm" disabled={busy}>Cancelar</button>
        <button type="submit" className="btn-primary text-sm" disabled={busy}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Agregar lead'}</button>
      </div>
    </form>
  )
}
