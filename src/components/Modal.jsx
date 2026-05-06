import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'

function useMobile() {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < 768,
  )
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const handler = (e) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  return isMobile
}

export default function Modal({ open, onClose, title, children, maxWidth = 'max-w-lg' }) {
  const isMobile = useMobile()

  return (
    <AnimatePresence>
      {open && (
        isMobile ? (
          <>
            {/* Backdrop */}
            <motion.div
              className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onClose}
            />

            {/* Drawer */}
            <motion.div
              className="fixed inset-x-0 bottom-0 z-50 panel rounded-t-2xl rounded-b-none flex flex-col overflow-hidden"
              style={{ maxHeight: '92dvh' }}
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            >
              {/* Drag handle */}
              <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
                <div className="w-10 h-1 rounded-full bg-nina-line" />
              </div>

              {/* Header */}
              <div className="flex items-center justify-between px-5 pt-1 pb-3 border-b border-nina-line flex-shrink-0">
                <h3 className="font-display text-xl silver-text">{title}</h3>
                <button onClick={onClose} className="btn-ghost !p-2">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Scrollable content */}
              <div className="flex-1 overflow-y-auto px-5 py-5">
                {children}
              </div>
            </motion.div>
          </>
        ) : (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div
              className="absolute inset-0 bg-black/70 backdrop-blur-sm"
              onClick={onClose}
            />
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.98 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
              className={`relative panel w-full ${maxWidth} p-6 max-h-[90vh] overflow-auto`}
            >
              <div className="flex items-start justify-between mb-5">
                <h3 className="font-display text-xl silver-text">{title}</h3>
                <button onClick={onClose} className="btn-ghost !p-2">
                  <X className="w-4 h-4" />
                </button>
              </div>
              {children}
            </motion.div>
          </motion.div>
        )
      )}
    </AnimatePresence>
  )
}
