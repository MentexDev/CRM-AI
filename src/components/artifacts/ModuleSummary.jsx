// Sección "Resumen" CALCULADA de un módulo: lee las hojas (sheets) del módulo y muestra totales en vivo
// (sumas de columnas numéricas, desglose de un monto por categoría/estado, conteos por opción, checklist).
// Se recalcula cada vez que se entra a la sección, reflejando lo último que el equipo editó.
import { useMemo } from 'react'
import { BarChart3 } from 'lucide-react'

const colName = (c) => (typeof c === 'string' || typeof c === 'number' ? String(c) : c?.name ?? '')
const colType = (c) => (typeof c === 'object' && c ? c.type || 'text' : 'text')
// Mismo criterio que SheetView (formato COP: "." de miles, "," decimal) → los totales del Resumen
// coinciden con los que muestra la propia hoja. Devuelve 0 si la celda no es un número.
const parseNum = (v) => {
  const s = String(v ?? '').trim()
  if (!s) return 0
  const cleaned = s.replace(/[$\s%]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(/,/g, '.')
  if (!/^-?\d*\.?\d+$/.test(cleaned)) return 0
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : 0
}
const fmtNum = (n) => n.toLocaleString('es-CO', { maximumFractionDigits: 2 })
const isChecked = (v) => ['true', '✓', 'si', 'sí', '1', 'x'].includes(String(v ?? '').trim().toLowerCase())

function sheetStats(data) {
  const cols = (data?.columns || []).map((c, i) => ({ name: colName(c) || `Columna ${i + 1}`, type: colType(c), idx: i }))
  const rows = Array.isArray(data?.rows) ? data.rows : []
  const cellAt = (row, i) => (Array.isArray(row) ? row[i] : row?.[cols[i]?.name]) ?? ''
  const numCols = cols.filter((c) => c.type === 'number')
  const selCols = cols.filter((c) => c.type === 'select')
  const chkCols = cols.filter((c) => c.type === 'checkbox')
  const metrics = []

  for (const nc of numCols) {
    const sum = rows.reduce((a, r) => a + parseNum(cellAt(r, nc.idx)), 0)
    metrics.push({ label: `Total ${nc.name}`, value: fmtNum(sum) })
  }
  // Desglose del primer monto por cada columna de estado (ej. Monto por Tipo → ingresos vs gastos).
  if (numCols.length) {
    const nc = numCols[0]
    for (const sc of selCols) {
      const by = {}
      for (const r of rows) {
        const k = String(cellAt(r, sc.idx) || '').trim() || '—'
        by[k] = (by[k] || 0) + parseNum(cellAt(r, nc.idx))
      }
      const parts = Object.entries(by).map(([k, v]) => `${k}: ${fmtNum(v)}`)
      if (parts.length) metrics.push({ label: `${nc.name} por ${sc.name}`, value: parts.join('   ·   '), wide: true })
    }
  }
  for (const sc of selCols) {
    const counts = {}
    for (const r of rows) {
      const v = String(cellAt(r, sc.idx) || '').trim()
      if (v) counts[v] = (counts[v] || 0) + 1
    }
    const parts = Object.entries(counts).map(([k, v]) => `${k}: ${v}`)
    if (parts.length) metrics.push({ label: `Conteo por ${sc.name}`, value: parts.join('   ·   '), wide: true })
  }
  for (const cc of chkCols) {
    const done = rows.reduce((a, r) => a + (isChecked(cellAt(r, cc.idx)) ? 1 : 0), 0)
    metrics.push({ label: cc.name, value: `${done} / ${rows.length}` })
  }
  return { rows: rows.length, metrics }
}

export default function ModuleSummary({ sections = [], section }) {
  const sheets = useMemo(() => sections.filter((s) => s?.kind === 'sheet'), [sections])
  return (
    <div className="h-full overflow-y-auto bg-nina-ink">
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        <div>
          <h1 className="font-display text-2xl silver-text flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-nina-silver" /> {section?.title || 'Resumen'}
          </h1>
          <p className="text-[13px] text-nina-mute mt-1">Totales calculados automáticamente de las secciones del módulo. Se actualizan cuando el equipo edita los datos.</p>
        </div>
        {sheets.length === 0 ? (
          <div className="rounded-2xl border border-nina-line bg-nina-panel/40 p-6 text-nina-mute text-sm">Este módulo no tiene hojas para resumir.</div>
        ) : (
          sheets.map((s, i) => {
            const st = sheetStats(s.data || {})
            return (
              <section key={i} className="rounded-2xl border border-nina-line bg-nina-panel/40 p-5">
                <div className="flex items-baseline justify-between mb-3">
                  <h2 className="text-[15px] font-semibold text-nina-chrome">{s.title}</h2>
                  <span className="text-[12px] text-nina-mute">{st.rows} fila{st.rows === 1 ? '' : 's'}</span>
                </div>
                {st.metrics.length === 0 ? (
                  <div className="text-[12.5px] text-nina-mute">Sin columnas numéricas o de estado para resumir.</div>
                ) : (
                  <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                    {st.metrics.map((m, j) => (
                      <div key={j} className={`rounded-xl border border-nina-line bg-nina-ink/40 px-3.5 py-3 ${m.wide ? 'col-span-2 lg:col-span-3' : ''}`}>
                        <div className="text-[11px] uppercase tracking-wide text-nina-mute truncate">{m.label}</div>
                        <div className="text-[15px] font-semibold text-nina-chrome mt-0.5 break-words">{m.value}</div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )
          })
        )}
      </div>
    </div>
  )
}
