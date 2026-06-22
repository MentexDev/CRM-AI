// Módulo Contactos — los clientes externos de la marca. Fase 1: crear/editar/buscar/eliminar + etiquetas.
// Al crear un contacto se crea también su LEAD en la primera etapa → aparece en el Pipeline (Kanban).
// En Fase 2 los contactos se crean SOLOS cuando un número escribe por WhatsApp (webhook + unique phone).
import { useCallback, useEffect, useState } from 'react'
import { Loader2, Plus, Search, Pencil, Trash2, User } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '../../../lib/supabase'
import Modal from '../../../components/Modal'
import { CsShell, CsEmpty, useCsBrand } from './CsShell'

export default function CsContacts() {
  const { brands, brandId, setBrandId } = useCsBrand()
  const [contacts, setContacts] = useState([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState(null)
  const [confirmDel, setConfirmDel] = useState(null)

  const load = useCallback(async () => {
    if (!brandId) { setContacts([]); setLoading(false); return }
    setLoading(true)
    const { data, error } = await supabase
      .from('cs_contacts')
      .select('id, name, phone, avatar, tags, created_at')
      .eq('brand_id', brandId)
      .order('created_at', { ascending: false })
    if (error) toast.error('No pude cargar los contactos: ' + error.message)
    setContacts(data ?? [])
    setLoading(false)
  }, [brandId])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!brandId) return
    const ch = supabase.channel(`cs_contacts-${brandId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cs_contacts', filter: `brand_id=eq.${brandId}` }, load)
      .subscribe()
    return () => { try { supabase.removeChannel(ch) } catch { /* */ } }
  }, [brandId, load])

  const filtered = contacts.filter((c) => {
    const n = q.trim().toLowerCase()
    return !n || (c.name || '').toLowerCase().includes(n) || (c.phone || '').includes(n) || (c.tags || []).some((t) => t.toLowerCase().includes(n))
  })

  const save = async (form) => {
    const phone = (form.phone || '').trim()
    if (!phone) { toast.error('El número es obligatorio'); return }
    const tags = (form.tags || '').split(',').map((t) => t.trim()).filter(Boolean)
    const payload = { name: (form.name || '').trim() || null, phone, tags }
    if (editing?.id) {
      const { error } = await supabase.from('cs_contacts').update(payload).eq('id', editing.id)
      if (error) { toast.error(error.code === '23505' ? 'Ya existe un contacto con ese número' : error.message); return }
      toast.success('Contacto actualizado')
    } else {
      const { data: u } = await supabase.auth.getUser()
      const { data: c, error } = await supabase.from('cs_contacts').insert({ ...payload, brand_id: brandId, created_by: u?.user?.id ?? null }).select('id').single()
      if (error) { toast.error(error.code === '23505' ? 'Ya existe un contacto con ese número' : error.message); return }
      // Crear su lead en la primera etapa → aparece en el Pipeline.
      const { data: st } = await supabase.from('cs_stages').select('id').eq('brand_id', brandId).order('position', { ascending: true }).limit(1)
      await supabase.from('cs_leads').insert({ brand_id: brandId, contact_id: c.id, stage_id: st?.[0]?.id ?? null, created_by: u?.user?.id ?? null })
      toast.success('Contacto creado')
    }
    setEditing(null)
    load()
  }

  const del = async () => {
    if (!confirmDel) return
    const { error } = await supabase.from('cs_contacts').delete().eq('id', confirmDel.id)
    if (error) toast.error(error.message); else toast.success('Contacto eliminado')
    setConfirmDel(null)
    load()
  }

  const initial = (c) => (c.name || c.phone || '?').trim().charAt(0).toUpperCase()

  return (
    <CsShell
      title="Contactos"
      subtitle="Los clientes de este workspace. Editables y con etiquetas."
      brands={brands}
      brandId={brandId}
      onBrand={setBrandId}
      actions={<button onClick={() => setEditing({})} disabled={!brandId} className="btn-primary !py-2 !px-3 text-[13px] disabled:opacity-40"><Plus className="w-4 h-4" /> Agregar contacto</button>}
    >
      <div className="relative mb-5">
        <Search className="w-4 h-4 text-nina-mute absolute left-3 top-1/2 -translate-y-1/2" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre, número o etiqueta…" className="w-full bg-nina-ink border border-nina-line rounded-xl pl-10 pr-4 py-3 text-[13px] text-nina-chrome placeholder:text-nina-mute/60 outline-none focus:border-nina-silver/40" />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-nina-mute"><Loader2 className="w-5 h-5 animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <CsEmpty icon={User} title={contacts.length ? 'Sin resultados' : 'Aún no hay contactos'} hint={contacts.length ? 'Prueba con otra búsqueda.' : 'Agrega tu primer contacto. Cuando conectemos WhatsApp, se crearán solos al escribir.'} />
      ) : (
        <div className="space-y-2">
          {filtered.map((c) => (
            <div key={c.id} className="group flex items-center gap-3.5 rounded-xl border border-nina-line bg-nina-panel/60 px-4 py-3 hover:border-nina-silver/30 transition">
              <span className="w-10 h-10 grid place-items-center rounded-full bg-silver-gradient text-nina-black font-semibold shrink-0">{initial(c)}</span>
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-medium text-nina-chrome truncate">{c.name || c.phone}</div>
                <div className="flex items-center gap-2 flex-wrap mt-0.5">
                  <span className="text-[12px] text-nina-mute">{c.phone}</span>
                  {(c.tags || []).map((t) => <span key={t} className="text-[10px] px-1.5 py-0.5 rounded-full bg-nina-line/50 text-nina-silver">{t}</span>)}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition">
                <button onClick={() => setEditing(c)} title="Editar" className="w-8 h-8 grid place-items-center rounded-lg text-nina-mute hover:text-nina-chrome hover:bg-nina-line/40"><Pencil className="w-4 h-4" /></button>
                <button onClick={() => setConfirmDel(c)} title="Eliminar" className="w-8 h-8 grid place-items-center rounded-lg text-nina-mute hover:text-red-300 hover:bg-nina-line/40"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Editar contacto' : 'Nuevo contacto'} maxWidth="max-w-md">
        {editing && <ContactForm initial={editing} onSave={save} onCancel={() => setEditing(null)} />}
      </Modal>

      <Modal open={!!confirmDel} onClose={() => setConfirmDel(null)} title="Eliminar contacto" maxWidth="max-w-sm">
        <p className="text-[13px] text-nina-mute mb-5">¿Eliminar a <span className="text-nina-chrome">{confirmDel?.name || confirmDel?.phone}</span>? Se borrarán también su lead y sus conversaciones.</p>
        <div className="flex justify-end gap-2">
          <button onClick={() => setConfirmDel(null)} className="btn-ghost text-sm">Cancelar</button>
          <button onClick={del} className="btn !bg-red-500/90 hover:!bg-red-500 text-white text-sm">Eliminar</button>
        </div>
      </Modal>
    </CsShell>
  )
}

function ContactForm({ initial, onSave, onCancel }) {
  const [name, setName] = useState(initial.name || '')
  const [phone, setPhone] = useState(initial.phone || '')
  const [tags, setTags] = useState((initial.tags || []).join(', '))
  const [busy, setBusy] = useState(false)
  const submit = async (e) => { e.preventDefault(); setBusy(true); await onSave({ name, phone, tags }); setBusy(false) }
  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="label">Número de WhatsApp *</label>
        <input className="input font-mono text-[13px]" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+57 300 000 0000" autoFocus={!initial.id} />
      </div>
      <div>
        <label className="label">Nombre</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre del cliente" />
      </div>
      <div>
        <label className="label">Etiquetas (separadas por coma)</label>
        <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="vip, mayorista, bogotá" />
      </div>
      <div className="flex justify-end gap-2 pt-2 border-t border-nina-line">
        <button type="button" onClick={onCancel} className="btn-ghost text-sm" disabled={busy}>Cancelar</button>
        <button type="submit" className="btn-primary text-sm" disabled={busy}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : (initial.id ? 'Guardar' : 'Crear contacto')}</button>
      </div>
    </form>
  )
}
