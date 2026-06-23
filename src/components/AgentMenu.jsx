import { useState } from 'react'
import toast from 'react-hot-toast'
import { ChevronDown, ChevronUp, MoreHorizontal, Pencil, Pin, PinOff, Trash2 } from 'lucide-react'
import { useConfirm } from './ConfirmDialog'
import { supabase } from '../lib/supabase'

// Menú de opciones (⋯) de un agente en el sidebar — mismo estilo que ConversationMenu.
// Acciones: Fijar/Desfijar, Editar, Mover arriba/abajo, Eliminar. Solo para la Junta (RLS lo exige).
// `agents` es la lista YA ORDENADA (como se ve en el sidebar) → para mover por vecinos.
export function AgentMenu({ agent, agents = [], onNavigate, onAfterDelete, buttonClassName = '', menuClassName = '' }) {
  const confirm = useConfirm()
  const [open, setOpen] = useState(false)
  if (!agent) return null

  const i = agents.findIndex((a) => a.id === agent.id)
  const canUp = i > 0
  const canDown = i >= 0 && i < agents.length - 1

  const togglePin = async () => {
    const { error } = await supabase.from('agents').update({ pinned: !agent.pinned }).eq('id', agent.id)
    if (error) toast.error('No se pudo fijar'); else toast.success(agent.pinned ? 'Agente desfijado' : 'Agente fijado')
  }

  // Reordena: intercambia con el vecino y RENUMERA todos (robusto aunque el sort_order esté en 0 por defecto).
  const move = async (dir) => {
    const arr = [...agents]
    const j = i + dir
    if (i < 0 || j < 0 || j >= arr.length) return
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
    const res = await Promise.all(arr.map((a, idx) => supabase.from('agents').update({ sort_order: idx }).eq('id', a.id)))
    if (res.some((r) => r.error)) toast.error('No se pudo reordenar')
  }

  const doDelete = async () => {
    const ok = await confirm({
      title: `¿Eliminar a ${agent.name}?`,
      description: 'Se borra el agente junto con sus conversaciones, tareas y memoria. Esta acción no se puede deshacer.',
      confirmText: 'Eliminar',
      variant: 'danger',
    })
    if (!ok) return
    const { error } = await supabase.from('agents').delete().eq('id', agent.id)
    if (error) { toast.error('No se pudo eliminar: ' + error.message); return }
    toast.success('Agente eliminado')
    onAfterDelete?.()
  }

  const item = (label, Icon, onClick, danger = false) => (
    <button
      onClick={() => { setOpen(false); onClick() }}
      className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-[12.5px] text-left transition hover:bg-nina-line/40 ${danger ? 'text-red-300 hover:text-red-200' : 'text-nina-mute hover:text-nina-chrome'}`}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  )

  return (
    <div className="relative">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v) }}
        data-open={open}
        className={buttonClassName}
        title="Opciones"
        aria-label={`Opciones de ${agent.name}`}
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={(e) => { e.stopPropagation(); setOpen(false) }} />
          <div className={`absolute z-50 w-52 rounded-xl border border-nina-line bg-nina-panel shadow-xl py-1 ${menuClassName || 'right-0 top-full mt-1'}`}>
            {item(agent.pinned ? 'Desfijar' : 'Fijar', agent.pinned ? PinOff : Pin, togglePin)}
            {item('Editar', Pencil, () => onNavigate?.(`/admin/agentes/${agent.slug}?edit=${agent.id}`))}
            {canUp && item('Mover arriba', ChevronUp, () => move(-1))}
            {canDown && item('Mover abajo', ChevronDown, () => move(1))}
            <div className="my-1 border-t border-nina-line/60" />
            {item('Eliminar', Trash2, doDelete, true)}
          </div>
        </>
      )}
    </div>
  )
}
