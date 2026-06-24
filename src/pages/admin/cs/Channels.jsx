// Módulo Canales — los números/canales de WhatsApp de la marca (estilo "Meus Canais" de la referencia,
// con diseño NINA). Fase 1: CRUD de la ficha del canal (crear/renombrar/editar/eliminar) + estado.
// La CONEXIÓN real por QR llega en Fase 2 (Evolution API) — aquí el botón "Conectar" queda preparado.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Bot, Check, Loader2, MessageCircle, Pencil, Plus, QrCode, Search, Trash2, Unplug, Zap, ZapOff } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '../../../lib/supabase'
import Modal from '../../../components/Modal'
import Select from '../../../components/Select'
import { useAgents } from '../../../hooks/useAgents'
import { CsShell, CsEmpty, useCsBrand } from './CsShell'

const STATUS = {
  connected: { label: 'Activo', cls: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30', dot: 'bg-emerald-400' },
  connecting: { label: 'Conectando', cls: 'text-amber-300 bg-amber-500/10 border-amber-500/30', dot: 'bg-amber-400' },
  disconnected: { label: 'Desconectado', cls: 'text-nina-mute bg-nina-line/40 border-nina-line', dot: 'bg-nina-mute' },
}

export default function CsChannels() {
  const { brands, brandId, setBrandId } = useCsBrand()
  const { agents } = useAgents()
  const brandAgents = agents.filter((a) => a.brand_id === brandId || !a.brand_id)
  const [channels, setChannels] = useState([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState(null) // null | {} (nuevo) | channel (editar)
  const [confirmDel, setConfirmDel] = useState(null)
  const [connecting, setConnecting] = useState(null) // canal que se está conectando (modal QR)

  const load = useCallback(async () => {
    if (!brandId) { setChannels([]); setLoading(false); return }
    setLoading(true)
    const { data, error } = await supabase
      .from('cs_channels')
      .select('id, name, description, status, phone, agent_id, auto_reply, created_at')
      .eq('brand_id', brandId)
      .order('created_at', { ascending: false })
    if (error) toast.error('No pude cargar los canales: ' + error.message)
    setChannels(data ?? [])
    setLoading(false)
  }, [brandId])

  useEffect(() => { load() }, [load])

  // Tiempo real: refresca cuando cambian los canales de la marca.
  useEffect(() => {
    if (!brandId) return
    const ch = supabase
      .channel(`cs_channels-${brandId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cs_channels', filter: `brand_id=eq.${brandId}` }, load)
      .subscribe()
    return () => { try { supabase.removeChannel(ch) } catch { /* */ } }
  }, [brandId, load])

  const filtered = channels.filter((c) => {
    const n = q.trim().toLowerCase()
    return !n || (c.name || '').toLowerCase().includes(n) || (c.phone || '').includes(n)
  })

  // Asignar el agente IA del canal + toggle de respuesta automática.
  const setChannelAgent = async (id, agentId) => {
    const patch = agentId ? { agent_id: agentId } : { agent_id: null, auto_reply: false }
    const { error } = await supabase.from('cs_channels').update(patch).eq('id', id)
    if (error) toast.error(error.message)
  }
  const toggleAuto = async (c) => {
    if (!c.agent_id) { toast('Asigna un agente primero', { icon: '🤖' }); return }
    const { error } = await supabase.from('cs_channels').update({ auto_reply: !c.auto_reply }).eq('id', c.id)
    if (error) toast.error(error.message)
  }

  const save = async (form) => {
    const name = (form.name || '').trim()
    if (!name) { toast.error('Pon un nombre al canal'); return }
    const payload = { name, description: (form.description || '').trim() }
    if (editing?.id) {
      const { error } = await supabase.from('cs_channels').update(payload).eq('id', editing.id)
      if (error) { toast.error(error.message); return }
      toast.success('Canal actualizado')
    } else {
      const { data: u } = await supabase.auth.getUser()
      const { error } = await supabase.from('cs_channels').insert({ ...payload, brand_id: brandId, status: 'disconnected', created_by: u?.user?.id ?? null })
      if (error) { toast.error(error.message); return }
      toast.success('Canal creado')
    }
    setEditing(null)
    load()
  }

  const del = async () => {
    if (!confirmDel) return
    // Si está conectado/conectando, cerrar la sesión en Evolution primero (evita instancia zombi).
    if (confirmDel.status && confirmDel.status !== 'disconnected') {
      await supabase.functions.invoke('cs-evolution', { body: { action: 'disconnect', channel_id: confirmDel.id } }).catch(() => {})
    }
    const { error } = await supabase.from('cs_channels').delete().eq('id', confirmDel.id)
    if (error) toast.error(error.message); else toast.success('Canal eliminado')
    setConfirmDel(null)
    load()
  }

  const disconnect = async (c) => {
    const { data, error } = await supabase.functions.invoke('cs-evolution', { body: { action: 'disconnect', channel_id: c.id } })
    if (error || data?.error) toast.error('No pude desconectar: ' + (data?.error || error.message)); else toast.success('Canal desconectado')
    load()
  }

  return (
    <CsShell
      title="Canales"
      subtitle="Gestiona los puntos de atención (números de WhatsApp) de este workspace."
      brands={brands}
      brandId={brandId}
      onBrand={setBrandId}
      actions={
        <button onClick={() => setEditing({})} disabled={!brandId} className="btn-primary !py-2 !px-3 text-[13px] disabled:opacity-40">
          <Plus className="w-4 h-4" /> Agregar canal
        </button>
      }
    >
      <div className="relative mb-5">
        <Search className="w-4 h-4 text-nina-mute absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por nombre o número…"
          className="w-full bg-nina-ink border border-nina-line rounded-xl pl-10 pr-4 py-3 text-[13px] text-nina-chrome placeholder:text-nina-mute/60 outline-none focus:border-nina-silver/40"
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-nina-mute"><Loader2 className="w-5 h-5 animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <CsEmpty icon={MessageCircle} title={channels.length ? 'Sin resultados' : 'Aún no hay canales'} hint={channels.length ? 'Prueba con otra búsqueda.' : 'Agrega tu primer canal de WhatsApp. La conexión por QR se habilita en la siguiente fase.'} />
      ) : (
        <div className="space-y-3">
          {filtered.map((c) => {
            const st = STATUS[c.status] || STATUS.disconnected
            return (
              <div key={c.id} className="group flex items-center gap-4 rounded-2xl border border-nina-line bg-nina-panel/60 px-4 py-3.5 hover:border-nina-silver/30 transition">
                <span className="w-12 h-12 grid place-items-center rounded-xl bg-emerald-500/15 text-emerald-300 shrink-0"><MessageCircle className="w-6 h-6" /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[15px] font-semibold text-nina-chrome truncate">{c.name}</span>
                    <span className={`inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full border ${st.cls}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} /> {st.label}
                    </span>
                  </div>
                  <div className="text-[12.5px] text-nina-mute truncate">{c.phone || c.description || 'Sin descripción'}</div>
                  {/* Agente IA del canal + respuesta automática */}
                  <div className="flex items-center gap-1.5 mt-2">
                    <Bot className="w-3.5 h-3.5 text-nina-mute shrink-0" />
                    <Select
                      value={c.agent_id || ''}
                      onChange={(v) => setChannelAgent(c.id, v || null)}
                      options={[{ value: '', label: 'Sin agente' }, ...brandAgents.map((a) => ({ value: a.id, label: a.name }))]}
                      className="max-w-[180px]"
                    />
                    <button
                      onClick={() => toggleAuto(c)}
                      disabled={!c.agent_id}
                      className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition disabled:opacity-40 ${c.auto_reply && c.agent_id ? 'bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25' : 'bg-nina-line/40 text-nina-mute hover:text-nina-chrome'}`}
                      title={c.agent_id ? 'Respuesta automática del agente' : 'Asigna un agente primero'}
                    >
                      {c.auto_reply && c.agent_id ? <><Zap className="w-3 h-3" /> Auto ON</> : <><ZapOff className="w-3 h-3" /> Auto OFF</>}
                    </button>
                  </div>
                </div>
                <div className="text-right shrink-0 hidden sm:block">
                  <div className="text-[11px] text-nina-mute">ID: #{c.id.slice(0, 6)}</div>
                  <div className="text-[11px] text-nina-mute/70">{new Date(c.created_at).toLocaleDateString('es-CO')}</div>
                </div>
                {c.status === 'connected' ? (
                  <button onClick={() => disconnect(c)} className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] text-nina-mute border border-nina-line hover:text-red-300 hover:border-red-400/40 transition" title="Desconectar"><Unplug className="w-3.5 h-3.5" /> Desconectar</button>
                ) : (
                  <button onClick={() => setConnecting(c)} className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 hover:bg-emerald-500/20 transition" title="Conectar por QR"><QrCode className="w-3.5 h-3.5" /> Conectar</button>
                )}
                <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition">
                  <button onClick={() => setEditing(c)} title="Editar" className="w-8 h-8 grid place-items-center rounded-lg text-nina-mute hover:text-nina-chrome hover:bg-nina-line/40"><Pencil className="w-4 h-4" /></button>
                  <button onClick={() => setConfirmDel(c)} title="Eliminar" className="w-8 h-8 grid place-items-center rounded-lg text-nina-mute hover:text-red-300 hover:bg-nina-line/40"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Crear / editar canal */}
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Editar canal' : 'Nuevo canal'} maxWidth="max-w-md">
        {editing && <ChannelForm initial={editing} onSave={save} onCancel={() => setEditing(null)} />}
      </Modal>

      {/* Confirmar eliminación */}
      <Modal open={!!confirmDel} onClose={() => setConfirmDel(null)} title="Eliminar canal" maxWidth="max-w-sm">
        <p className="text-[13px] text-nina-mute mb-5">¿Seguro que quieres eliminar <span className="text-nina-chrome">{confirmDel?.name}</span>? Se borrarán también sus conversaciones y contactos asociados.</p>
        <div className="flex justify-end gap-2">
          <button onClick={() => setConfirmDel(null)} className="btn-ghost text-sm">Cancelar</button>
          <button onClick={del} className="btn !bg-red-500/90 hover:!bg-red-500 text-white text-sm">Eliminar</button>
        </div>
      </Modal>

      {/* Conectar por QR */}
      <Modal open={!!connecting} onClose={() => setConnecting(null)} title={`Conectar ${connecting?.name || ''}`} maxWidth="max-w-sm">
        {connecting && <ConnectModal channel={connecting} onClose={() => setConnecting(null)} onDone={load} />}
      </Modal>
    </CsShell>
  )
}

// Conexión por QR: pide el QR a Evolution (vía cs-evolution), lo muestra y hace polling del estado
// hasta que WhatsApp queda vinculado.
function ConnectModal({ channel, onClose, onDone }) {
  const [qr, setQr] = useState(null)
  const [status, setStatus] = useState('loading') // loading | qr | connected | error
  const [err, setErr] = useState('')
  const pollRef = useRef(null)

  const start = useCallback(async () => {
    setStatus('loading'); setErr(''); setQr(null)
    const { data, error } = await supabase.functions.invoke('cs-evolution', { body: { action: 'connect', channel_id: channel.id } })
    if (error || data?.error) { setErr(data?.error || error?.message || 'Error'); setStatus('error'); return }
    if (data?.qr) { setQr(data.qr); setStatus('qr') } else { setErr('No recibí el QR. Reintenta.'); setStatus('error') }
  }, [channel.id])

  useEffect(() => { start() }, [start])

  // Polling del estado mientras se muestra el QR (con timeout: el QR de WhatsApp expira ~60s).
  useEffect(() => {
    if (status !== 'qr') return
    let n = 0
    pollRef.current = setInterval(async () => {
      n += 1
      if (n > 20) { clearInterval(pollRef.current); setStatus('expired'); return } // ~60s sin escanear
      const { data } = await supabase.functions.invoke('cs-evolution', { body: { action: 'state', channel_id: channel.id } })
      if (data?.status === 'connected') { clearInterval(pollRef.current); setStatus('connected'); onDone?.(); setTimeout(onClose, 1300) }
    }, 3000)
    return () => clearInterval(pollRef.current)
  }, [status, channel.id, onClose, onDone])

  const qrSrc = qr ? (qr.startsWith('data:') ? qr : `data:image/png;base64,${qr}`) : null
  return (
    <div className="text-center">
      {status === 'loading' && <div className="py-12 text-nina-mute flex items-center justify-center gap-2"><Loader2 className="w-5 h-5 animate-spin" /> Generando QR…</div>}
      {status === 'error' && (
        <div className="py-8">
          <div className="text-red-300 text-[13px] mb-3">{err}</div>
          <button onClick={start} className="btn-ghost text-sm">Reintentar</button>
        </div>
      )}
      {status === 'qr' && qrSrc && (
        <div className="py-1">
          <img src={qrSrc} alt="QR de WhatsApp" className="w-56 h-56 mx-auto rounded-xl bg-white p-2" />
          <p className="text-[12.5px] text-nina-mute mt-3 leading-relaxed">En tu teléfono: <b className="text-nina-chrome">WhatsApp → Ajustes → Dispositivos vinculados → Vincular dispositivo</b>, y escanea este código.</p>
          <button onClick={start} className="btn-ghost text-sm mt-3">Refrescar QR</button>
        </div>
      )}
      {status === 'expired' && (
        <div className="py-10">
          <div className="text-nina-mute text-[13px] mb-3">El QR expiró sin conectarse. Genera uno nuevo.</div>
          <button onClick={start} className="btn-primary text-sm">Generar QR nuevo</button>
        </div>
      )}
      {status === 'connected' && <div className="py-12 text-emerald-300 flex flex-col items-center justify-center gap-2"><Check className="w-8 h-8" /><span className="text-[14px]">¡Conectado!</span></div>}
    </div>
  )
}

function ChannelForm({ initial, onSave, onCancel }) {
  const [name, setName] = useState(initial.name || '')
  const [description, setDescription] = useState(initial.description || '')
  const [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    await onSave({ name, description })
    setBusy(false)
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="label">Nombre del canal *</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: WhatsApp Ventas" autoFocus />
      </div>
      <div>
        <label className="label">Descripción</label>
        <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Opcional" />
      </div>
      <div className="flex justify-end gap-2 pt-2 border-t border-nina-line">
        <button type="button" onClick={onCancel} className="btn-ghost text-sm" disabled={busy}>Cancelar</button>
        <button type="submit" className="btn-primary text-sm" disabled={busy}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : (initial.id ? 'Guardar' : 'Crear canal')}</button>
      </div>
    </form>
  )
}
