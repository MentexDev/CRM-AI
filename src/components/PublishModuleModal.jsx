import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, Send } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import Modal from './Modal'

// Modal para PUBLICAR una plantilla del canvas como módulo navegable a pantalla completa. Pregunta el
// nombre del módulo, guarda un SNAPSHOT del artefacto en public.published_modules y navega al módulo.
const PUBLISHABLE = ['document', 'sheet', 'board', 'slides']

export default function PublishModuleModal({ open, onClose, artifact, conversationId, agentId }) {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) setName(artifact?.title || '')
  }, [open, artifact])

  if (!artifact) return null
  const kind = artifact.type
  const ok = PUBLISHABLE.includes(kind)

  const publish = async () => {
    const title = name.trim()
    if (!title || saving || !ok) return
    setSaving(true)
    try {
      // Snapshot del payload del artefacto (sin los campos internos del canvas ni el title duplicado:
      // el título canónico vive en la columna `title`).
      const { type, key, messageId, title: _omitTitle, ...data } = artifact
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const { data: row, error } = await supabase
        .from('published_modules')
        .insert({
          title,
          kind,
          data,
          source_conversation_id: conversationId || null,
          source_artifact_key: key || null,
          agent_id: agentId || null,
          created_by: user?.id || null,
        })
        .select('id')
        .single()
      if (error) throw error
      toast.success('Módulo publicado')
      onClose?.()
      navigate(`/admin/modulos/${row.id}`)
    } catch (e) {
      console.error('[CRM-AI] publish module:', e)
      toast.error('No se pudo publicar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Publicar como módulo" maxWidth="max-w-md">
      <div className="space-y-4">
        <p className="text-[13px] text-nina-mute leading-relaxed">
          Se creará un módulo a pantalla completa con esta plantilla, accesible desde el menú de arriba (la flecha →).
          Es una foto del estado actual: si la sigues mejorando en Code, vuelve a publicar para actualizarla.
        </p>
        <div>
          <label className="block text-[12px] text-nina-mute mb-1.5">¿Cómo se llamará el módulo?</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') publish()
            }}
            autoFocus
            placeholder="Ej. Tablero de producción"
            className="w-full bg-nina-ink border border-nina-line rounded-lg px-3 py-2 text-[13px] text-nina-chrome outline-none focus:border-nina-silver/40 transition"
          />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="btn-ghost text-sm">Cancelar</button>
          <button onClick={publish} disabled={!name.trim() || saving} className="btn-primary text-sm flex items-center gap-1.5 disabled:opacity-40">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Publicar
          </button>
        </div>
      </div>
    </Modal>
  )
}
