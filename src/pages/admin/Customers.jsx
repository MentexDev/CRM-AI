import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Download, Search, UserRound } from 'lucide-react'
import * as XLSX from 'xlsx'
import toast from 'react-hot-toast'
import { useData } from '../../context/DataContext'
import EmptyState from '../../components/EmptyState'
import { fmtCOP, fmtDate, fmtNumber } from '../../lib/format'

const FIELDS = ['name', 'cedula', 'phone', 'email', 'address']

const hasAnyData = (c) => FIELDS.some((k) => c?.[k] && c[k] !== 'NA')

export default function Customers() {
  const { sales } = useData()
  const [q, setQ] = useState('')

  const customers = useMemo(() => {
    const map = new Map()
    for (const s of sales) {
      const c = s.customer || {}
      if (!hasAnyData(c)) continue

      // Clave: cédula si la tienen, si no nombre normalizado
      const key =
        c.cedula && c.cedula !== 'NA'
          ? `ced:${c.cedula.trim()}`
          : `name:${(c.name || '').trim().toLowerCase()}`

      const existing = map.get(key) || {
        name: 'NA',
        cedula: 'NA',
        phone: 'NA',
        email: 'NA',
        address: 'NA',
        purchases: 0,
        units: 0,
        totalSpent: 0,
        lastPurchase: null,
        firstPurchase: null,
      }
      // Acumular
      existing.purchases += 1
      existing.units += s.quantity
      existing.totalSpent += s.total
      const soldAt = new Date(s.soldAt)
      if (!existing.lastPurchase || soldAt > new Date(existing.lastPurchase)) {
        existing.lastPurchase = s.soldAt
        // El último registro tiene los datos más recientes — los usamos como canónicos
        for (const k of FIELDS) {
          if (c[k] && c[k] !== 'NA') existing[k] = c[k]
        }
      }
      if (!existing.firstPurchase || soldAt < new Date(existing.firstPurchase)) {
        existing.firstPurchase = s.soldAt
      }
      // Si todavía falta algún campo y este registro lo tiene, completar
      for (const k of FIELDS) {
        if ((!existing[k] || existing[k] === 'NA') && c[k] && c[k] !== 'NA') {
          existing[k] = c[k]
        }
      }
      map.set(key, existing)
    }
    return Array.from(map.values()).sort(
      (a, b) => new Date(b.lastPurchase) - new Date(a.lastPurchase),
    )
  }, [sales])

  const filtered = useMemo(() => {
    if (!q) return customers
    const t = q.toLowerCase()
    return customers.filter((c) =>
      FIELDS.some((k) => String(c[k] || '').toLowerCase().includes(t)),
    )
  }, [customers, q])

  const totalSpent = filtered.reduce((a, c) => a + c.totalSpent, 0)
  const totalUnits = filtered.reduce((a, c) => a + c.units, 0)

  const exportExcel = () => {
    if (filtered.length === 0) {
      toast.error('No hay clientes para exportar')
      return
    }
    const headers = [
      'Nombre',
      'Cédula',
      'Celular',
      'Correo',
      'Dirección',
      'Compras',
      'Unidades',
      'Total gastado',
      'Primera compra',
      'Última compra',
    ]
    const rows = filtered.map((c) => [
      c.name,
      c.cedula,
      c.phone,
      c.email,
      c.address,
      c.purchases,
      c.units,
      Number(c.totalSpent) || 0,
      c.firstPurchase ? new Date(c.firstPurchase).toLocaleString('es-CO') : '',
      c.lastPurchase ? new Date(c.lastPurchase).toLocaleString('es-CO') : '',
    ])
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
    ws['!cols'] = [
      { wch: 28 },
      { wch: 14 },
      { wch: 14 },
      { wch: 28 },
      { wch: 32 },
      { wch: 10 },
      { wch: 10 },
      { wch: 14 },
      { wch: 22 },
      { wch: 22 },
    ]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Clientes')
    const date = new Date().toISOString().slice(0, 10)
    XLSX.writeFile(wb, `clientes_NINA_${date}.xlsx`)
    toast.success(`${filtered.length} clientes exportados`)
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl silver-text">Clientes</h1>
          <p className="text-nina-mute text-sm mt-1">
            {fmtNumber(filtered.length)} clientes con datos · {fmtNumber(totalUnits)}{' '}
            unidades · {fmtCOP(totalSpent)} en compras
          </p>
        </div>
        <div className="flex gap-2 w-full sm:w-auto flex-wrap">
          {customers.length > 0 && (
            <div className="relative flex-1 sm:w-72">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-nina-mute" />
              <input
                className="input pl-10"
                placeholder="Buscar por nombre, cédula, correo…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
          )}
          <button
            onClick={exportExcel}
            disabled={filtered.length === 0}
            className="btn-primary whitespace-nowrap"
          >
            <Download className="w-4 h-4" />
            Exportar Excel
          </button>
        </div>
      </div>

      {customers.length === 0 ? (
        <EmptyState
          icon={UserRound}
          title="Aún no hay clientes con datos"
          description="Cuando registres una venta y completes los datos opcionales del cliente (nombre, cédula, celular, correo, dirección), aparecerán aquí. Las ventas anónimas (sin datos) no se cuentan."
        />
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="panel overflow-hidden"
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-nina-mute uppercase text-[10px] tracking-[0.18em] border-b border-nina-line bg-nina-ink/60">
                  <th className="px-3 py-3">Nombre</th>
                  <th className="px-3 py-3">Cédula</th>
                  <th className="px-3 py-3">Celular</th>
                  <th className="px-3 py-3">Correo</th>
                  <th className="px-3 py-3">Dirección</th>
                  <th className="px-3 py-3 text-center">Compras</th>
                  <th className="px-3 py-3 text-center">Unid.</th>
                  <th className="px-3 py-3 text-right">Total</th>
                  <th className="px-3 py-3">Última</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c, i) => (
                  <motion.tr
                    key={`${c.cedula}-${c.name}-${i}`}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.01 }}
                    className="border-b border-nina-line/40 hover:bg-nina-line/20 transition"
                  >
                    <td className="px-3 py-2 max-w-[180px] truncate" title={c.name}>
                      {c.name}
                    </td>
                    <td className="px-3 py-2 font-mono text-nina-chrome">{c.cedula}</td>
                    <td className="px-3 py-2 font-mono">{c.phone}</td>
                    <td className="px-3 py-2 max-w-[200px] truncate" title={c.email}>
                      {c.email}
                    </td>
                    <td className="px-3 py-2 max-w-[220px] truncate" title={c.address}>
                      {c.address}
                    </td>
                    <td className="px-3 py-2 text-center">{c.purchases}</td>
                    <td className="px-3 py-2 text-center">{c.units}</td>
                    <td className="px-3 py-2 text-right silver-text font-semibold whitespace-nowrap">
                      {fmtCOP(c.totalSpent)}
                    </td>
                    <td className="px-3 py-2 text-nina-mute whitespace-nowrap">
                      {fmtDate(c.lastPurchase)}
                    </td>
                  </motion.tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-nina-line bg-nina-ink/40 font-semibold">
                  <td colSpan={5} className="px-3 py-3 text-[11px] uppercase tracking-[0.18em] text-nina-mute">
                    Totales
                  </td>
                  <td className="px-3 py-3 text-center silver-text">
                    {filtered.reduce((a, c) => a + c.purchases, 0)}
                  </td>
                  <td className="px-3 py-3 text-center silver-text">{totalUnits}</td>
                  <td className="px-3 py-3 text-right silver-text font-display text-base">
                    {fmtCOP(totalSpent)}
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </motion.div>
      )}
    </div>
  )
}
