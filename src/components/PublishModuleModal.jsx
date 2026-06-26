import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, Loader2, Send } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { kindMeta } from '../lib/artifactKinds'
import Modal from './Modal'

// Modal para PUBLICAR una plantilla del canvas como MÓDULO multi-sección. Eliges qué pestañas
// (document/sheet/board/slides) entran como secciones; se guardan en public.published_modules.sections.
// Re-publicar la misma conversación ACTUALIZA el mismo módulo (mismo id/URL) en vez de duplicar.
const PUBLISHABLE = ['document', 'sheet', 'board', 'slides']

export default function PublishModuleModal({ open, onClose, tabs, activeKey, conversationId, agentId }) {
  const navigate = useNavigate()
  const publishable = (tabs || []).filter((t) => PUBLISHABLE.includes(t.type))
  const [name, setName] = useState('')
  const [selected, setSelected] = useState(() => new Set())
  const [saving, setSaving] = useState(false)
  const [existing, setExisting] = useState(null) // { id, title } si esta conversación ya tiene módulo

  // Al abrir: marca todas las pestañas, propone nombre, y detecta si esta conversación ya está publicada
  // (para ACTUALIZAR el mismo módulo en vez de crear otro).
  useEffect(() => {
    if (!open) return
    const pub = (tabs || []).filter((t) => PUBLISHABLE.includes(t.type))
    setSelected(new Set(pub.map((t) => t.key)))
    const active = pub.find((t) => t.key === activeKey)
    let alive = true
    ;(async () => {
      let found = null
      const {
        data: { user },
      } = await supabase.auth.getUser()
      // Solo MI módulo de esta conversación → re-publicar nunca intenta sobrescribir el de otro usuario.
      if (conversationId && user) {
        const { data } = await supabase
          .from('published_modules')
          .select('id, title')
          .eq('source_conversation_id', conversationId)
          .eq('created_by', user.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        found = data || null
      }
      if (!alive) return
      setExisting(found)
      setName(found?.title || active?.title || pub[0]?.title || '')
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, conversationId, activeKey])

  if (!open) return null

  const toggle = (key) =>
    setSelected((prev) => {
      const n = new Set(prev)
      if (n.has(key)) n.delete(key)
      else n.add(key)
      return n
    })

  const chosen = publishable.filter((t) => selected.has(t.key))

  const publish = async () => {
    const title = name.trim()
    if (!title || saving || chosen.length === 0) return
    setSaving(true)
    try {
      // Cada pestaña elegida → una sección (sin los campos internos del canvas: type/key/messageId/title).
      const sections = chosen.map((a, i) => {
        const { type, key, messageId, title: _t, ...payload } = a
        return { id: String(key || `s${i}`), title: a.title || kindMeta(type).label, kind: type, data: payload }
      })
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const base = {
        title,
        kind: sections[0].kind, // kind representativo (para el ícono del menú)
        sections,
        source_conversation_id: conversationId || null,
        source_artifact_key: chosen[0]?.key || null,
        agent_id: agentId || null,
      }
      let id = existing?.id
      let updated = false
      if (id) {
        // Intenta ACTUALIZAR mi módulo. El .select() confirma si realmente aplicó: si RLS lo filtra
        // (0 filas) o ya no existe, caemos a crear uno nuevo en vez de reportar un éxito falso.
        const { data: upd, error } = await supabase.from('published_modules').update(base).eq('id', id).select('id')
        if (error) throw error
        updated = Boolean(upd && upd.length)
        if (!updated) id = null
      }
      if (updated) {
        toast.success('Módulo actualizado')
      } else {
        const { data: row, error } = await supabase
          .from('published_modules')
          .insert({ ...base, created_by: user?.id || null })
          .select('id')
          .single()
        if (error) throw error
        id = row.id
        toast.success('Módulo publicado')
      }
      onClose?.()
      navigate(`/admin/modulos/${id}`)
    } catch (e) {
      console.error('[CRM-AI] publish module:', e)
      toast.error('No se pudo publicar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={existing ? 'Actualizar módulo' : 'Publicar como módulo'} maxWidth="max-w-md">
      <div className="space-y-4">
        <p className="text-[13px] text-nina-mute leading-relaxed">
          {existing
            ? 'Esta plantilla ya está publicada como módulo. Al guardar, se actualiza con las secciones que elijas.'
            : 'Se creará un módulo a pantalla completa con las secciones que elijas, accesible desde el menú del sidebar.'}{' '}
          Es una foto del estado actual: para actualizarla, vuelve a publicar.
        </p>
        <div>
          <label className="block text-[12px] text-nina-mute mb-1.5">¿Cómo se llamará el módulo?</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            placeholder="Ej. Tracker de Gastos"
            className="w-full bg-nina-ink border border-nina-line rounded-lg px-3 py-2 text-[13px] text-nina-chrome outline-none focus:border-nina-silver/40 transition"
          />
        </div>
        <div>
          <label className="block text-[12px] text-nina-mute mb-1.5">Secciones a incluir ({chosen.length})</label>
          {publishable.length === 0 ? (
            <div className="text-[12.5px] text-nina-mute px-1 py-2">No hay pestañas publicables en esta plantilla.</div>
          ) : (
            <div className="space-y-1 max-h-60 overflow-y-auto">
              {publishable.map((t) => {
                const m = kindMeta(t.type)
                const Icon = m.Icon
                const on = selected.has(t.key)
                return (
                  <button
                    key={t.key}
                    onClick={() => toggle(t.key)}
                    className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg border text-left transition ${on ? 'border-nina-line bg-nina-line/30' : 'border-transparent hover:bg-nina-line/20'}`}
                  >
                    <span className={`w-4 h-4 rounded grid place-items-center shrink-0 border ${on ? 'bg-nina-silver border-nina-silver text-nina-black' : 'border-nina-line text-transparent'}`}>
                      <Check className="w-3 h-3" />
                    </span>
                    <Icon className={`w-4 h-4 shrink-0 ${m.color}`} />
                    <span className="flex-1 min-w-0 truncate text-[13px] text-nina-chrome">{t.title || m.label}</span>
                    <span className="text-[10px] text-nina-mute shrink-0">{m.label}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="btn-ghost text-sm">Cancelar</button>
          <button onClick={publish} disabled={!name.trim() || saving || chosen.length === 0} className="btn-primary text-sm flex items-center gap-1.5 disabled:opacity-40">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} {existing ? 'Actualizar' : 'Publicar'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
