import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { MoreVertical, Pause, Pencil, Play, Trash2 } from 'lucide-react'

/**
 * Menú "..." que aparece en cada agente de la lista (sólo para Junta Directiva).
 * Acciones: Editar · Pausar/Reactivar · Eliminar.
 *
 * Es un popover anclado al botón. Cierra al hacer click fuera o al pulsar Esc.
 */
export default function AgentActionsMenu({ agent, onEdit, onTogglePause, onDelete }) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e) => {
      if (!wrapperRef.current?.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const isPaused = agent.status === 'disabled'

  const stop = (handler) => (e) => {
    e.stopPropagation()
    e.preventDefault()
    setOpen(false)
    handler()
  }

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          e.preventDefault()
          setOpen((v) => !v)
        }}
        className="p-1.5 rounded-md text-nina-mute hover:text-nina-chrome hover:bg-nina-line/40 transition"
        aria-label="Acciones del agente"
      >
        <MoreVertical className="w-4 h-4" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.96 }}
            transition={{ duration: 0.12 }}
            className="absolute right-0 top-full mt-1 z-30 min-w-[180px] rounded-xl border border-nina-line bg-nina-panel shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={stop(onEdit)}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-nina-chrome hover:bg-nina-line/40 transition"
            >
              <Pencil className="w-3.5 h-3.5" />
              Editar perfil
            </button>
            <button
              type="button"
              onClick={stop(onTogglePause)}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-nina-chrome hover:bg-nina-line/40 transition"
            >
              {isPaused ? (
                <>
                  <Play className="w-3.5 h-3.5" />
                  Reactivar
                </>
              ) : (
                <>
                  <Pause className="w-3.5 h-3.5" />
                  Pausar
                </>
              )}
            </button>
            <div className="border-t border-nina-line" />
            <button
              type="button"
              onClick={stop(onDelete)}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-red-300 hover:bg-red-500/10 transition"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Eliminar
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
