// Piezas compartidas del módulo "Atención al Cliente" (CRM + multiatención).
// - useCsBrand: marca activa del módulo (selector + persistencia). Multi-tenant por marca.
// - CsShell: cabecera estándar (título + subtítulo + selector de marca + acciones) con diseño NINA.
import { useEffect, useState } from 'react'
import { useBrands } from '../../../hooks/useBrands'

const KEY = 'nina:cs:brand'

export function useCsBrand() {
  const { brands, loading } = useBrands()
  const [brandId, setBrandId] = useState(() => {
    try { return localStorage.getItem(KEY) || '' } catch { return '' }
  })
  // Default a la primera marca accesible cuando carguen (o si la guardada ya no existe).
  useEffect(() => {
    if (!loading && brands.length && !brands.some((b) => b.id === brandId)) {
      setBrandId(brands[0].id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, brands])
  const set = (id) => { setBrandId(id); try { localStorage.setItem(KEY, id) } catch { /* */ } }
  return { brands, brandId, brand: brands.find((b) => b.id === brandId) || null, setBrandId: set, loading }
}

export function CsShell({ title, subtitle, brands = [], brandId, onBrand, actions, children }) {
  return (
    <div className="px-5 sm:px-7 py-6 max-w-6xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-nina-chrome">{title}</h1>
          {subtitle && <p className="text-[13px] text-nina-mute mt-1">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {brands.length > 1 && (
            <select
              value={brandId}
              onChange={(e) => onBrand(e.target.value)}
              className="bg-nina-ink border border-nina-line rounded-lg px-3 py-2 text-[13px] text-nina-chrome outline-none focus:border-nina-silver/40"
              title="Marca / workspace"
            >
              {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          {actions}
        </div>
      </div>
      {children}
    </div>
  )
}

// Estado vacío reutilizable (diseño NINA).
export function CsEmpty({ icon: Icon, title, hint }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-20 px-6">
      {Icon && <span className="w-14 h-14 grid place-items-center rounded-full bg-nina-line/30 text-nina-mute mb-4"><Icon className="w-6 h-6" /></span>}
      <div className="text-[15px] font-semibold text-nina-chrome mb-1">{title}</div>
      {hint && <div className="text-[12.5px] text-nina-mute max-w-sm leading-relaxed">{hint}</div>}
    </div>
  )
}

// Placeholder de los módulos que se construyen en próximas tandas (para que la navegación funcione).
export function CsComing({ title, subtitle, what }) {
  const { brands, brandId, setBrandId } = useCsBrand()
  return (
    <CsShell title={title} subtitle={subtitle} brands={brands} brandId={brandId} onBrand={setBrandId}>
      <div className="rounded-2xl border border-dashed border-nina-line bg-nina-panel/40 px-6 py-16 text-center">
        <div className="text-[15px] font-semibold text-nina-chrome mb-1">En construcción</div>
        <div className="text-[12.5px] text-nina-mute max-w-md mx-auto leading-relaxed">{what}</div>
      </div>
    </CsShell>
  )
}
