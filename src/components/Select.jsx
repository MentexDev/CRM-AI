// Select — dropdown con diseño NINA, reemplazo del <select> nativo (sin menú del sistema).
// El menú se renderiza en un portal (position: fixed) para NO recortarse dentro de modales/contenedores
// con overflow. Cierra al hacer clic fuera, al hacer scroll/resize y con Escape. Preserva el TIPO del
// value (number/string) — onChange recibe el value original de la opción, no un string.
//
// Uso:
//   <Select value={v} onChange={setV} options={[{ value, label, icon? }]} placeholder="…" className="w-full" />
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'

export default function Select({ value, onChange, options = [], placeholder = 'Seleccionar…', disabled = false, className = '', buttonClassName = '' }) {
  const [open, setOpen] = useState(false)
  const [rect, setRect] = useState(null)
  const btnRef = useRef(null)
  const menuRef = useRef(null)

  const place = () => {
    const r = btnRef.current?.getBoundingClientRect()
    if (!r) return
    // Flip hacia ARRIBA si no hay espacio suficiente abajo (p.ej. el composer al fondo del panel).
    const spaceBelow = window.innerHeight - r.bottom - 8
    const spaceAbove = r.top - 8
    const estH = Math.min(options.length * 38 + 8, 264)
    const up = spaceBelow < estH && spaceAbove > spaceBelow
    // Limitar la altura al espacio real del lado elegido → nunca se sale del viewport (scrollea dentro).
    const maxH = Math.max(120, Math.min(264, up ? spaceAbove : spaceBelow))
    setRect({ left: r.left, width: r.width, top: up ? r.top - 4 : r.bottom + 4, up, maxH })
  }
  const toggle = () => { if (disabled) return; if (!open) place(); setOpen((o) => !o) }

  useEffect(() => {
    if (!open) return
    const onDoc = (e) => {
      if (btnRef.current?.contains(e.target) || menuRef.current?.contains(e.target)) return
      setOpen(false)
    }
    const close = () => setOpen(false)
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const current = options.find((o) => String(o.value) === String(value))

  return (
    <div className={`relative ${className}`}>
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        onClick={toggle}
        className={`w-full flex items-center gap-2 bg-nina-ink border rounded-lg pl-3 pr-2.5 py-2 text-[13px] text-nina-chrome outline-none transition disabled:opacity-40 disabled:cursor-not-allowed ${open ? 'border-nina-silver/40' : 'border-nina-line hover:border-nina-silver/40'} ${buttonClassName}`}
      >
        {current?.icon && <span className="shrink-0">{current.icon}</span>}
        <span className={`flex-1 text-left truncate ${current ? '' : 'text-nina-mute'}`}>{current ? current.label : placeholder}</span>
        <ChevronDown className={`w-4 h-4 text-nina-mute shrink-0 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && rect && createPortal(
        <div
          ref={menuRef}
          style={{ position: 'fixed', top: rect.top, left: rect.left, width: rect.width, zIndex: 9999, maxHeight: rect.maxH, ...(rect.up ? { transform: 'translateY(-100%)' } : null) }}
          className="rounded-xl border border-nina-line bg-nina-panel shadow-2xl p-1 overflow-y-auto"
        >
          {options.length === 0 && <div className="px-2.5 py-2 text-[12.5px] text-nina-mute">Sin opciones</div>}
          {options.map((o) => {
            const active = String(o.value) === String(value)
            return (
              <button
                key={String(o.value)}
                type="button"
                onClick={() => { onChange(o.value); setOpen(false) }}
                className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-[13px] text-left transition ${active ? 'bg-nina-line/50 text-nina-chrome' : 'text-nina-mute hover:text-nina-chrome hover:bg-nina-line/30'}`}
              >
                {o.icon && <span className="shrink-0">{o.icon}</span>}
                <span className="flex-1 truncate">{o.label}</span>
                {active && <Check className="w-3.5 h-3.5 shrink-0 text-nina-chrome" />}
              </button>
            )
          })}
        </div>,
        document.body,
      )}
    </div>
  )
}
