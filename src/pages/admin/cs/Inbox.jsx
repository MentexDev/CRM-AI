// Módulo Inbox — bandeja COMPARTIDA de atención. Lista de conversaciones + hilo de mensajes en TIEMPO
// REAL (Supabase Realtime). Iniciar conversación manual (crea/reusa contacto + conversación). Enviar
// mensajes (outbound del operador). Fase 1: sin WhatsApp todavía — el envío real a WhatsApp llega en
// Fase 2 (Evolution). Mientras, el inbox funciona para conversaciones internas/manuales. Diseño NINA.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Bot, Check, Loader2, MessageSquare, Mic, Pause, Plus, Search, Send, Smile } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '../../../lib/supabase'
import Modal from '../../../components/Modal'
import { useVoiceTranscription } from '../../../hooks/useVoiceTranscription'
import { normPhone, useCsBrand } from './CsShell'

const EMOJIS = ['😀', '😁', '😂', '🤣', '😊', '😍', '😘', '😎', '🤩', '🥳', '😇', '🙂', '😉', '😋', '🤗', '🤔', '😅', '😴', '🙄', '😬', '😮', '😢', '😭', '😱', '👍', '👎', '🙏', '👏', '🙌', '💪', '🤝', '👋', '✌️', '🔥', '✨', '🎉', '❤️', '🧡', '💛', '💚', '💙', '💜', '💯', '✅', '❌', '⚠️', '📌', '🛒', '💰', '🎁', '📦', '🚀', '⏰', '📅', '📍', '📞']

export default function CsInbox() {
  const { brands, brandId, setBrandId } = useCsBrand()
  const [convs, setConvs] = useState([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [activeId, setActiveId] = useState(null)
  const [showNew, setShowNew] = useState(false)
  const [me, setMe] = useState(null)

  useEffect(() => { supabase.auth.getUser().then(({ data }) => setMe(data?.user?.id ?? null)) }, [])

  const loadConvs = useCallback(async () => {
    if (!brandId) { setConvs([]); setLoading(false); return }
    setLoading(true)
    const { data } = await supabase
      .from('cs_conversations')
      .select('id, last_message, last_message_at, unread, status, channel_id, agent_active, cs_contacts!inner(id, name, phone)')
      .eq('brand_id', brandId)
      .order('last_message_at', { ascending: false, nullsFirst: false })
    setConvs(data ?? [])
    setLoading(false)
  }, [brandId])

  useEffect(() => { loadConvs() }, [loadConvs])
  // Tiempo real de la lista (nuevas conversaciones / último mensaje / no leídos).
  useEffect(() => {
    if (!brandId) return
    const ch = supabase.channel(`cs_inbox-${brandId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cs_conversations', filter: `brand_id=eq.${brandId}` }, loadConvs)
      .subscribe()
    return () => { try { supabase.removeChannel(ch) } catch { /* */ } }
  }, [brandId, loadConvs])

  const filtered = convs.filter((c) => {
    const n = q.trim().toLowerCase()
    const ct = c.cs_contacts || {}
    return !n || (ct.name || '').toLowerCase().includes(n) || (ct.phone || '').includes(n)
  })
  const active = convs.find((c) => c.id === activeId) || null

  // Iniciar conversación manual: reusa/crea contacto por número y reusa/crea su conversación abierta.
  const startConversation = async ({ name, phone }) => {
    const ph = normPhone(phone)
    if (!ph) { toast.error('El número es obligatorio'); return }
    let { data: contact } = await supabase.from('cs_contacts').select('id').eq('brand_id', brandId).eq('phone', ph).maybeSingle()
    if (!contact) {
      const { data: c, error } = await supabase.from('cs_contacts').insert({ brand_id: brandId, name: (name || '').trim() || null, phone: ph, created_by: me }).select('id').single()
      if (error) { toast.error(error.message); return }
      contact = c
      // un contacto nuevo entra al pipeline en la primera etapa
      const { data: st } = await supabase.from('cs_stages').select('id').eq('brand_id', brandId).order('position', { ascending: true }).limit(1)
      await supabase.from('cs_leads').insert({ brand_id: brandId, contact_id: c.id, stage_id: st?.[0]?.id ?? null, created_by: me })
    }
    let { data: conv } = await supabase.from('cs_conversations').select('id').eq('brand_id', brandId).eq('contact_id', contact.id).eq('status', 'open').maybeSingle()
    if (!conv) {
      const { data: cv, error } = await supabase.from('cs_conversations').insert({ brand_id: brandId, contact_id: contact.id }).select('id').single()
      if (error) { toast.error(error.message); return }
      conv = cv
    }
    setShowNew(false)
    await loadConvs()
    setActiveId(conv.id)
  }

  return (
    <div className="h-full flex">
      {/* Lista */}
      <aside className="w-80 shrink-0 border-r border-nina-line/60 flex flex-col bg-nina-panel/30">
        <div className="px-3.5 pt-4 pb-2 shrink-0">
          <div className="flex items-center justify-between gap-2 mb-3">
            <h1 className="text-[17px] font-semibold text-nina-chrome">Conversaciones</h1>
            <button onClick={() => setShowNew(true)} disabled={!brandId} className="w-7 h-7 grid place-items-center rounded-lg bg-silver-gradient text-nina-black disabled:opacity-40" title="Nueva conversación"><Plus className="w-4 h-4" /></button>
          </div>
          {brands.length > 1 && (
            <select value={brandId} onChange={(e) => setBrandId(e.target.value)} className="w-full mb-2 bg-nina-ink border border-nina-line rounded-lg px-2.5 py-1.5 text-[12.5px] text-nina-chrome outline-none focus:border-nina-silver/40">
              {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          <div className="relative">
            <Search className="w-4 h-4 text-nina-mute absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar…" className="w-full bg-nina-ink border border-nina-line rounded-lg pl-9 pr-3 py-2 text-[12.5px] text-nina-chrome placeholder:text-nina-mute/60 outline-none focus:border-nina-silver/40" />
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-nina-mute"><Loader2 className="w-5 h-5 animate-spin" /></div>
          ) : filtered.length === 0 ? (
            <div className="text-center text-[12.5px] text-nina-mute py-10 px-4">{convs.length ? 'Sin resultados.' : 'Aún no hay conversaciones. Inicia una con el botón +.'}</div>
          ) : filtered.map((c) => {
            const ct = c.cs_contacts || {}
            return (
              <button key={c.id} onClick={() => setActiveId(c.id)} className={`w-full text-left flex items-center gap-2.5 px-2.5 py-2.5 rounded-xl transition ${activeId === c.id ? 'bg-nina-line/50' : 'hover:bg-nina-line/30'}`}>
                <span className="w-9 h-9 grid place-items-center rounded-full bg-silver-gradient text-nina-black text-[12px] font-semibold shrink-0">{(ct.name || ct.phone || '?').trim().charAt(0).toUpperCase()}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium text-nina-chrome truncate flex-1">{ct.name || ct.phone}</span>
                    {c.unread > 0 && <span className="text-[10px] min-w-[18px] h-[18px] px-1 grid place-items-center rounded-full bg-emerald-500 text-white">{c.unread}</span>}
                  </div>
                  <div className="text-[11.5px] text-nina-mute truncate">{c.last_message || 'Sin mensajes'}</div>
                </div>
              </button>
            )
          })}
        </div>
      </aside>

      {/* Hilo */}
      <section className="flex-1 min-w-0 flex flex-col">
        {active ? <Thread conv={active} me={me} brandId={brandId} onRead={loadConvs} /> : (
          <div className="flex-1 flex flex-col items-center justify-center text-center text-nina-mute px-6">
            <MessageSquare className="w-10 h-10 mb-3 opacity-40" />
            <div className="text-[14px] text-nina-chrome">Selecciona una conversación</div>
            <div className="text-[12.5px]">o inicia una nueva con el botón +.</div>
          </div>
        )}
      </section>

      <Modal open={showNew} onClose={() => setShowNew(false)} title="Nueva conversación" maxWidth="max-w-md">
        {showNew && <NewConvForm onSave={startConversation} onCancel={() => setShowNew(false)} />}
      </Modal>
    </div>
  )
}

function Thread({ conv, me, brandId, onRead }) {
  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const endRef = useRef(null)
  const taRef = useRef(null)
  const ct = conv.cs_contacts || {}
  // Pausa/reactiva la respuesta automática del agente en ESTA conversación (handoff humano).
  const [agentActive, setAgentActive] = useState(conv.agent_active !== false)
  useEffect(() => { setAgentActive(conv.agent_active !== false) }, [conv.id, conv.agent_active])
  const toggleAgent = async () => {
    const next = !agentActive
    setAgentActive(next)
    const { error } = await supabase.from('cs_conversations').update({ agent_active: next }).eq('id', conv.id)
    if (error) { setAgentActive(!next); toast.error('No se pudo cambiar el agente') }
    else toast.success(next ? '🤖 Agente reactivado' : '⏸ Agente en pausa — respondes tú')
  }
  // Micrófono de notas de voz: el MISMO hook del chat de los agentes (dicta y rellena el mensaje).
  const voice = useVoiceTranscription({
    lang: 'es-CO',
    onFinalResult: (t) => setText((prev) => (prev ? prev.replace(/\s+$/, '') + ' ' : '') + t),
    onError: (m) => toast.error(m),
  })
  const addEmoji = (e) => { setText((prev) => prev + e); setEmojiOpen(false); taRef.current?.focus() }

  const load = useCallback(async () => {
    const { data } = await supabase.from('cs_messages').select('id, direction, sender_type, type, content, created_at').eq('conversation_id', conv.id).order('created_at', { ascending: true })
    setMessages(data ?? [])
  }, [conv.id])

  useEffect(() => {
    load()
    // Marcar como leído al abrir (la lista se refresca sola por Realtime de cs_conversations → sin doble fetch).
    if (conv.unread > 0) supabase.from('cs_conversations').update({ unread: 0 }).eq('id', conv.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conv.id])

  // Tiempo real: mensajes nuevos de ESTA conversación. Si llega uno ENTRANTE con el hilo abierto, lo
  // marcamos leído de inmediato (el trigger lo cuenta como no leído al insertar).
  useEffect(() => {
    const ch = supabase.channel(`cs_thread-${conv.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'cs_messages', filter: `conversation_id=eq.${conv.id}` }, (p) => {
        setMessages((prev) => (prev.some((m) => m.id === p.new.id) ? prev : [...prev, p.new]))
        if (p.new?.direction === 'inbound') supabase.from('cs_conversations').update({ unread: 0 }).eq('id', conv.id)
      })
      .subscribe()
    return () => { try { supabase.removeChannel(ch) } catch { /* */ } }
  }, [conv.id])

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const send = async () => {
    const body = text.trim()
    if (!body || sending) return
    setSending(true)
    setText('')
    if (conv.channel_id) {
      // Conversación con canal de WhatsApp → enviar DE VERDAD (cs-evolution envía + guarda el mensaje).
      const { data, error } = await supabase.functions.invoke('cs-evolution', { body: { action: 'send', channel_id: conv.channel_id, conversation_id: conv.id, text: body } })
      setSending(false)
      if (error || data?.error) { toast.error('No pude enviar: ' + (data?.error || error.message)); setText(body); return }
    } else {
      // Conversación interna/manual (sin canal) → solo se guarda.
      const { error } = await supabase.from('cs_messages').insert({ brand_id: brandId, conversation_id: conv.id, direction: 'outbound', sender_type: 'operator', sender_id: me, type: 'text', content: body })
      setSending(false)
      if (error) { toast.error(error.message); setText(body); return }
    }
    load() // el trigger actualiza last_message; el mensaje llega por Realtime o por load()
  }

  return (
    <>
      <div className="flex items-center gap-3 px-5 py-3 border-b border-nina-line/60 shrink-0">
        <span className="w-9 h-9 grid place-items-center rounded-full bg-silver-gradient text-nina-black text-[12px] font-semibold shrink-0">{(ct.name || ct.phone || '?').trim().charAt(0).toUpperCase()}</span>
        <div className="min-w-0">
          <div className="text-[14px] font-medium text-nina-chrome truncate">{ct.name || ct.phone}</div>
          <div className="text-[11.5px] text-nina-mute truncate">{ct.phone}</div>
        </div>
        <button
          onClick={toggleAgent}
          title={agentActive ? 'Pausar el agente en esta conversación (respondes tú)' : 'Reactivar el agente para que responda solo'}
          className={`ml-auto flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-medium transition shrink-0 ${agentActive ? 'bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25' : 'bg-nina-line/50 text-nina-mute hover:text-nina-chrome'}`}
        >
          {agentActive ? <Bot className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
          {agentActive ? 'Agente activo' : 'Pausado'}
        </button>
      </div>
      {/* Hilo con fondo estilo WhatsApp (fondo-chat.png) + tinte oscuro para legibilidad sobre el tema NINA */}
      <div
        className="relative flex-1 min-h-0 overflow-y-auto"
        style={{ backgroundImage: 'linear-gradient(rgba(10,10,10,0.84), rgba(10,10,10,0.84)), url(/fondo-chat.png)', backgroundSize: 'cover', backgroundPosition: 'center' }}
      >
        <div className="px-5 py-4 space-y-1.5">
          {messages.length === 0 && <div className="text-center text-[12.5px] text-nina-mute py-10">Sin mensajes. Escribe el primero abajo.</div>}
          {messages.map((m) => {
            const out = m.direction === 'outbound'
            return (
              <div key={m.id} className={`flex ${out ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[72%] rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed shadow-md ${out ? 'bg-silver-gradient text-nina-black rounded-br-md' : 'bg-nina-panel/95 text-nina-chrome border border-nina-line rounded-bl-md'}`}>
                  {m.type !== 'text' ? <span className="italic opacity-80">[{m.type}]</span> : m.content}
                  <span className={`flex items-center justify-end gap-1 text-[9.5px] mt-0.5 ${out ? 'text-nina-black/55' : 'text-nina-mute'}`}>
                    {new Date(m.created_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                    {out && <Check className="w-3 h-3" />}
                  </span>
                </div>
              </div>
            )
          })}
          <div ref={endRef} />
        </div>
      </div>
      <div className="px-3 py-3 border-t border-nina-line/60 shrink-0 relative">
        {/* Selector de emojis */}
        {emojiOpen && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setEmojiOpen(false)} />
            <div className="absolute bottom-full left-3 mb-2 z-40 w-[19rem] max-h-56 overflow-y-auto rounded-2xl border border-nina-line bg-nina-panel shadow-2xl p-2 grid grid-cols-8 gap-0.5">
              {EMOJIS.map((e, i) => <button key={i} type="button" onClick={() => addEmoji(e)} className="w-8 h-8 grid place-items-center rounded-lg hover:bg-nina-line/50 text-[18px]">{e}</button>)}
            </div>
          </>
        )}
        {voice.status === 'listening' && voice.interimText && (
          <div className="text-[11px] text-nina-silver mb-1.5 px-12 truncate">{voice.interimText}…</div>
        )}
        <div className="flex items-end gap-1.5">
          <button type="button" onClick={() => setEmojiOpen((o) => !o)} className={`w-10 h-10 grid place-items-center rounded-xl shrink-0 transition ${emojiOpen ? 'text-nina-chrome bg-nina-line/40' : 'text-nina-mute hover:text-nina-chrome hover:bg-nina-line/40'}`} title="Emojis"><Smile className="w-5 h-5" /></button>
          <textarea
            ref={taRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
            rows={1}
            placeholder={voice.status === 'listening' ? 'Escuchando… habla' : 'Escribe un mensaje…'}
            className="flex-1 resize-none bg-nina-ink border border-nina-line rounded-xl px-3.5 py-2.5 text-[13px] text-nina-chrome placeholder:text-nina-mute/60 outline-none focus:border-nina-silver/40 max-h-32"
          />
          {voice.isSupported && (
            <button type="button" onClick={voice.toggle} title={voice.status === 'listening' ? 'Detener' : 'Dictar por voz'} className={`w-10 h-10 grid place-items-center rounded-xl shrink-0 transition ${voice.status === 'listening' ? 'bg-red-500/90 text-white animate-pulse' : 'text-nina-mute hover:text-nina-chrome hover:bg-nina-line/40'}`}>
              <Mic className="w-5 h-5" />
            </button>
          )}
          <button onClick={send} disabled={!text.trim() || sending} className="w-10 h-10 grid place-items-center rounded-xl bg-silver-gradient text-nina-black disabled:opacity-40 shrink-0">
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
        <div className="text-[10.5px] text-nina-mute/70 mt-1.5 text-center">{conv.channel_id ? 'Se envía por WhatsApp.' : 'Conversación interna (sin canal de WhatsApp).'}</div>
      </div>
    </>
  )
}

function NewConvForm({ onSave, onCancel }) {
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
        <label className="label">Nombre (si es nuevo)</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre del cliente" />
      </div>
      <div className="flex justify-end gap-2 pt-2 border-t border-nina-line">
        <button type="button" onClick={onCancel} className="btn-ghost text-sm" disabled={busy}>Cancelar</button>
        <button type="submit" className="btn-primary text-sm" disabled={busy}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Iniciar'}</button>
      </div>
    </form>
  )
}
