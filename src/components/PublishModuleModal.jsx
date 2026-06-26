import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, ChevronDown, ChevronUp, Loader2, Send } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { kindMeta } from '../lib/artifactKinds'
import { SECTION_ICONS, SECTION_ICON_KEYS, SECTION_ICON_LABEL, suggestIcon } from '../lib/sectionIcons'
import Modal from './Modal'

// Modal para PUBLICAR una plantilla del canvas como MÓDULO multi-sección. Eliges qué pestañas entran,
// en qué ORDEN (↑↓) y con qué ÍCONO; se guardan en public.published_modules.sections. Re-publicar la
// misma conversación ACTUALIZA el mismo módulo (mismo id/URL) en vez de duplicar.
const PUBLISHABLE = ['document', 'sheet', 'board', 'slides']

export default function PublishModuleModal({ open, onClose, tabs, activeKey, conversationId, agentId }) {
  const navigate = useNavigate()
  const publishable = (tabs || []).filter((t) => PUBLISHABLE.includes(t.type))
  const [name, setName] = useState('')
  const [rows, setRows] = useState([]) // [{key, title, kind, included, icon}] en ORDEN
  const [saving, setSaving] = useState(false)
  const [existing, setExisting] = useState(null)
  const [pickerFor, setPickerFor] = useState(null)

  // Al abrir: arma las filas (todas marcadas, ícono sugerido), propone nombre y detecta MI módulo de
  // esta conversación (para actualizarlo en vez de crear otro).
  useEffect(() => {
    if (!open) return
    const pub = (tabs || []).filter((t) => PUBLISHABLE.includes(t.type))
    setRows(pub.map((t) => ({ key: t.key, title: t.title || kindMeta(t.type).label, kind: t.type, included: true, icon: suggestIcon(t.title, t.type) })))
    setPickerFor(null)
    const active = pub.find((t) => t.key === activeKey)
    let alive = true
    ;(async () => {
      let found = null
      const {
        data: { user },
      } = await supabase.auth.getUser()
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

  const toggle = (key) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, included: !r.included } : r)))
  const setIcon = (key, icon) => {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, icon } : r)))
    setPickerFor(null)
  }
  const move = (key, dir) =>
    setRows((rs) => {
      const i = rs.findIndex((r) => r.key === key)
      const j = i + dir
      if (i < 0 || j < 0 || j >= rs.length) return rs
      const next = [...rs]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })

  const chosen = rows.filter((r) => r.included)

  const publish = async () => {
    const title = name.trim()
    if (!title || saving || chosen.length === 0) return
    setSaving(true)
    try {
      const byKey = Object.fromEntries(publishable.map((t) => [t.key, t]))
      const sections = chosen.map((r, i) => {
        const a = byKey[r.key] || {}
        const { type, key, messageId, title: _t, ...data } = a
        return { id: String(r.key || `s${i}`), title: r.title, kind: r.kind, icon: r.icon, data }
      })
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const base = {
        title,
        kind: sections[0].kind,
        sections,
        source_conversation_id: conversationId || null,
        source_artifact_key: chosen[0]?.key || null,
        agent_id: agentId || null,
      }
      let id = existing?.id
      let updated = false
      if (id) {
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
          <label className="block text-[12px] text-nina-mute mb-1.5">Secciones — marca, ordena (↑↓) y elige su ícono ({chosen.length})</label>
          {rows.length === 0 ? (
            <div className="text-[12.5px] text-nina-mute px-1 py-2">No hay pestañas publicables en esta plantilla.</div>
          ) : (
            <div className="space-y-1 max-h-72 overflow-y-auto">
              {rows.map((r, i) => {
                const Icon = SECTION_ICONS[r.icon] || SECTION_ICONS.doc
                return (
                  <div key={r.key} className={`rounded-lg border transition ${r.included ? 'border-nina-line bg-nina-line/20' : 'border-transparent opacity-55'}`}>
                    <div className="flex items-center gap-2 px-2 py-1.5">
                      <button
                        onClick={() => toggle(r.key)}
                        aria-label="Incluir sección"
                        className={`w-4 h-4 rounded grid place-items-center shrink-0 border ${r.included ? 'bg-nina-silver border-nina-silver text-nina-black' : 'border-nina-line text-transparent'}`}
                      >
                        <Check className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => setPickerFor(pickerFor === r.key ? null : r.key)}
                        title="Cambiar ícono"
                        className="w-7 h-7 grid place-items-center rounded-lg border border-nina-line text-nina-silver hover:text-nina-chrome hover:border-nina-silver/40 transition shrink-0"
                      >
                        <Icon className="w-4 h-4" />
                      </button>
                      <span className="flex-1 min-w-0 truncate text-[13px] text-nina-chrome">{r.title}</span>
                      <span className="text-[10px] text-nina-mute shrink-0">{kindMeta(r.kind).label}</span>
                      <div className="flex flex-col shrink-0">
                        <button onClick={() => move(r.key, -1)} disabled={i === 0} aria-label="Subir" className="text-nina-mute hover:text-nina-chrome disabled:opacity-20 transition">
                          <ChevronUp className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => move(r.key, 1)} disabled={i === rows.length - 1} aria-label="Bajar" className="text-nina-mute hover:text-nina-chrome disabled:opacity-20 transition">
                          <ChevronDown className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    {pickerFor === r.key && (
                      <div className="grid grid-cols-8 gap-1 px-2 pb-2">
                        {SECTION_ICON_KEYS.map((k) => {
                          const IC = SECTION_ICONS[k]
                          return (
                            <button
                              key={k}
                              onClick={() => setIcon(r.key, k)}
                              title={SECTION_ICON_LABEL[k]}
                              className={`h-7 grid place-items-center rounded-md border transition ${r.icon === k ? 'border-nina-silver bg-nina-line/40 text-nina-chrome' : 'border-nina-line/60 text-nina-mute hover:text-nina-chrome hover:bg-nina-line/30'}`}
                            >
                              <IC className="w-4 h-4" />
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
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
