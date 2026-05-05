import { createContext, useCallback, useContext, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle } from 'lucide-react'

const ConfirmContext = createContext(null)

export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null) // { title, description, confirmText, cancelText, variant }
  const resolverRef = useRef(null)

  const confirm = useCallback((opts = {}) => {
    return new Promise((resolve) => {
      resolverRef.current = resolve
      setState({
        title: opts.title || '¿Estás seguro?',
        description: opts.description || '',
        confirmText: opts.confirmText || 'Confirmar',
        cancelText: opts.cancelText || 'Cancelar',
        variant: opts.variant || 'danger', // 'danger' | 'primary'
      })
    })
  }, [])

  const close = (result) => {
    setState(null)
    if (resolverRef.current) {
      resolverRef.current(result)
      resolverRef.current = null
    }
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AnimatePresence>
        {state && (
          <motion.div
            className="fixed inset-0 z-[60] flex items-center justify-center p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div
              className="absolute inset-0 bg-black/70 backdrop-blur-sm"
              onClick={() => close(false)}
            />
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.98 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
              className="relative panel w-full max-w-md p-6"
            >
              <div className="flex items-start gap-4">
                <div
                  className={`shrink-0 grid place-items-center w-12 h-12 rounded-full border ${
                    state.variant === 'danger'
                      ? 'bg-red-500/10 border-red-500/30 text-red-300'
                      : 'bg-nina-line border-nina-line text-nina-silver'
                  }`}
                >
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-display text-lg silver-text leading-tight">
                    {state.title}
                  </h3>
                  {state.description && (
                    <p className="text-sm text-nina-mute mt-2">{state.description}</p>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-2 mt-6">
                <button onClick={() => close(false)} className="btn-ghost">
                  {state.cancelText}
                </button>
                <button
                  onClick={() => close(true)}
                  autoFocus
                  className={state.variant === 'danger' ? 'btn-danger' : 'btn-primary'}
                >
                  {state.confirmText}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </ConfirmContext.Provider>
  )
}

export const useConfirm = () => {
  const ctx = useContext(ConfirmContext)
  if (!ctx) {
    // Fallback al confirm nativo si el provider no está montado (no debería pasar)
    return (opts) =>
      Promise.resolve(window.confirm(`${opts.title || ''}\n\n${opts.description || ''}`))
  }
  return ctx
}
