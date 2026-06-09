import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import {
  Archive,
  ArchiveRestore,
  Check,
  ExternalLink,
  Globe,
  Link2,
  Lock,
  MoreHorizontal,
  Pencil,
  Share2,
  Star,
  Trash2,
} from 'lucide-react'
import Modal from './Modal'
import { useConfirm } from './ConfirmDialog'
import { supabase } from '../lib/supabase'

// Diálogo de compartir — estilo Manus (Solo yo / Acceso público).
export function ShareDialog({ conv, onClose }) {
  const [access, setAccess] = useState('private')

  useEffect(() => {
    if (conv) setAccess('private')
  }, [conv])

  if (!conv) return null
  const slug = conv.agents?.slug
  const link = slug ? `${window.location.origin}/admin/agentes/${slug}?c=${conv.id}` : ''

  const shareNow = async () => {
    if (access === 'public') {
      try {
        await navigator.clipboard.writeText(link)
        toast.success('Enlace copiado al portapapeles')
      } catch {
        toast.error('No se pudo copiar el enlace')
      }
    } else {
      toast('Esta conversación es privada — solo tú la ves', { icon: '🔒' })
    }
    onClose()
  }

  const Option = ({ icon: Icon, title, desc, value }) => (
    <button
      onClick={() => setAccess(value)}
      className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left transition ${
        access === value
          ? 'border-nina-silver/40 bg-nina-line/30'
          : 'border-nina-line hover:bg-nina-line/20'
      }`}
    >
      <div className="w-9 h-9 rounded-lg grid place-items-center bg-nina-line/40 text-nina-chrome shrink-0">
        <Icon className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-nina-chrome">{title}</div>
        <div className="text-[11px] text-nina-mute">{desc}</div>
      </div>
      {access === value && <Check className="w-4 h-4 text-nina-chrome shrink-0" />}
    </button>
  )

  return (
    <Modal open={Boolean(conv)} onClose={onClose} title="Compartir" maxWidth="max-w-md">
      <div className="space-y-2">
        <Option icon={Lock} title="Solo yo" desc="Visible solo para ti" value="private" />
        <Option icon={Globe} title="Acceso público" desc="Cualquiera con un enlace puede ver" value="public" />
      </div>
      <button onClick={shareNow} className="btn-primary w-full justify-center mt-4 flex items-center gap-2">
        <Link2 className="w-4 h-4" />
        Comparte ahora
      </button>
    </Modal>
  )
}

// Menú de opciones (⋯) de una conversación. Autónomo: maneja favorito,
// archivar, renombrar, compartir, abrir en nueva pestaña y eliminar.
export function ConversationMenu({ conv, onAfterDelete, buttonClassName = '', menuClassName = '' }) {
  const confirm = useConfirm()
  const [open, setOpen] = useState(false)
  const [shareConv, setShareConv] = useState(null)
  const [renameOpen, setRenameOpen] = useState(false)
  const [draft, setDraft] = useState('')

  if (!conv) return null
  const slug = conv.agents?.slug

  const update = async (patch, okMsg) => {
    const { error } = await supabase.from('conversations').update(patch).eq('id', conv.id)
    if (error) toast.error('No se pudo actualizar')
    else if (okMsg) toast.success(okMsg)
  }

  const doRename = async () => {
    const name = draft.trim()
    setRenameOpen(false)
    if (name && name !== conv.title) await update({ title: name })
  }

  const doDelete = async () => {
    const ok = await confirm({
      title: '¿Eliminar esta conversación?',
      description: 'Se borra junto con todos sus mensajes. Esta acción no se puede deshacer.',
      confirmText: 'Eliminar',
      variant: 'danger',
    })
    if (!ok) return
    const { error } = await supabase.from('conversations').delete().eq('id', conv.id)
    if (error) {
      toast.error('No se pudo eliminar')
      return
    }
    toast.success('Conversación eliminada')
    onAfterDelete?.()
  }

  const item = (label, Icon, onClick, danger = false) => (
    <button
      onClick={() => {
        setOpen(false)
        onClick()
      }}
      className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-[12.5px] text-left transition hover:bg-nina-line/40 ${
        danger ? 'text-red-300 hover:text-red-200' : 'text-nina-mute hover:text-nina-chrome'
      }`}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  )

  return (
    <div className="relative">
      <button
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        data-open={open}
        className={buttonClassName}
        title="Opciones"
        aria-label="Opciones de la conversación"
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className={`absolute z-50 w-56 rounded-xl border border-nina-line bg-nina-panel shadow-xl py-1 ${
              menuClassName || 'right-0 top-full mt-1'
            }`}
          >
            {item('Compartir', Share2, () => setShareConv(conv))}
            {item('Renombrar', Pencil, () => {
              setDraft(conv.title || '')
              setRenameOpen(true)
            })}
            {item(
              conv.is_favorite ? 'Quitar de favoritos' : 'Agregar a favoritos',
              Star,
              () => update({ is_favorite: !conv.is_favorite }),
            )}
            {item('Abrir en una nueva pestaña', ExternalLink, () => {
              if (slug) window.open(`/admin/agentes/${slug}?c=${conv.id}`, '_blank')
            })}
            <div className="my-1 border-t border-nina-line/60" />
            {item(
              conv.is_archived ? 'Desarchivar' : 'Archivar',
              conv.is_archived ? ArchiveRestore : Archive,
              () => update({ is_archived: !conv.is_archived }, conv.is_archived ? 'Desarchivada' : 'Conversación archivada'),
            )}
            {item('Eliminar', Trash2, doDelete, true)}
          </div>
        </>
      )}

      <ShareDialog conv={shareConv} onClose={() => setShareConv(null)} />

      <Modal open={renameOpen} onClose={() => setRenameOpen(false)} title="Renombrar conversación" maxWidth="max-w-sm">
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') doRename()
            if (e.key === 'Escape') setRenameOpen(false)
          }}
          className="input"
          placeholder="Nombre de la conversación"
        />
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={() => setRenameOpen(false)} className="btn-ghost">
            Cancelar
          </button>
          <button onClick={doRename} className="btn-primary">
            Guardar
          </button>
        </div>
      </Modal>
    </div>
  )
}
