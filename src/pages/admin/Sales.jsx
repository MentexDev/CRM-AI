import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Plus, Receipt, Search, Tag, Trash2, UserRound } from 'lucide-react'
import toast from 'react-hot-toast'
import { useData } from '../../context/DataContext'
import SaleModal from '../../components/SaleModal'
import { useConfirm } from '../../components/ConfirmDialog'
import { fmtCOP, fmtDate, fmtNumber } from '../../lib/format'

export default function Sales() {
  const { sales, cancelSale } = useData()
  const confirm = useConfirm()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)

  const filtered = useMemo(() => {
    if (!q) return sales
    const t = q.toLowerCase()
    return sales.filter(
      (s) =>
        s.productName.toLowerCase().includes(t) ||
        s.sellerName.toLowerCase().includes(t) ||
        String(s.size).toLowerCase().includes(t) ||
        String(s.sku || '').toLowerCase().includes(t) ||
        (s.customer?.name || '').toLowerCase().includes(t),
    )
  }, [sales, q])

  const total = filtered.reduce((a, s) => a + s.total, 0)
  const units = filtered.reduce((a, s) => a + s.quantity, 0)
  const discountSum = filtered.reduce((a, s) => a + (s.discount || 0), 0)

  const onCancel = async (s) => {
    const ok = await confirm({
      title: '¿Anular esta venta?',
      description: `${s.productName} (talla ${s.size}). Se devolverá la cantidad al stock.`,
      confirmText: 'Anular',
      variant: 'danger',
    })
    if (!ok) return
    try {
      await cancelSale(s.id)
      toast.success('Venta anulada y stock devuelto')
    } catch (err) {
      toast.error(err.message || 'No se pudo anular la venta')
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl silver-text">Historial de ventas</h1>
          <p className="text-nina-mute text-sm mt-1">
            {fmtNumber(filtered.length)} líneas · {fmtNumber(units)} unidades ·{' '}
            {fmtCOP(total)}
            {discountSum > 0 && (
              <>
                {' '}
                · <span className="text-amber-300/80">{fmtCOP(discountSum)} en descuentos</span>
              </>
            )}
          </p>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-72">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-nina-mute" />
            <input
              className="input pl-10"
              placeholder="Buscar vendedora, producto, cliente…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <button onClick={() => setOpen(true)} className="btn-primary whitespace-nowrap">
            <Plus className="w-4 h-4" />
            Registrar venta
          </button>
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="panel overflow-hidden"
      >
        {filtered.length === 0 ? (
          <div className="p-10 text-center text-nina-mute">
            <Receipt className="w-8 h-8 mx-auto mb-3 opacity-50" />
            No hay ventas registradas todavía.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-nina-mute uppercase text-[10px] tracking-[0.18em] border-b border-nina-line bg-nina-ink/60">
                  <th className="px-3 py-3">Fecha</th>
                  <th className="px-3 py-3">Vendedora</th>
                  <th className="px-3 py-3">Ref.</th>
                  <th className="px-3 py-3">Producto</th>
                  <th className="px-3 py-3 text-center">Talla</th>
                  <th className="px-3 py-3 text-center">Cant.</th>
                  <th className="px-3 py-3">Pago</th>
                  <th className="px-3 py-3 text-right">Total</th>
                  <th className="px-3 py-3 text-right">Desc.</th>
                  <th className="px-3 py-3">Cliente</th>
                  <th className="px-3 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s, i) => {
                  const hasCustomer =
                    s.customer && s.customer.name && s.customer.name !== 'NA'
                  return (
                    <motion.tr
                      key={s.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: i * 0.01 }}
                      className="border-b border-nina-line/40 hover:bg-nina-line/20 transition"
                    >
                      <td className="px-3 py-2 text-nina-mute whitespace-nowrap">
                        {fmtDate(s.soldAt)}
                      </td>
                      <td className="px-3 py-2">{s.sellerName}</td>
                      <td className="px-3 py-2 font-mono text-nina-chrome">
                        {s.sku || '—'}
                      </td>
                      <td className="px-3 py-2 max-w-[200px] truncate">{s.productName}</td>
                      <td className="px-3 py-2 text-center">
                        <span className="chip border-nina-line bg-nina-ink text-nina-chrome">
                          {s.size}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-center">{s.quantity}</td>
                      <td className="px-3 py-2 text-nina-mute">{s.paymentMethod}</td>
                      <td className="px-3 py-2 text-right silver-text font-semibold whitespace-nowrap">
                        {fmtCOP(s.total)}
                      </td>
                      <td className="px-3 py-2 text-right text-amber-300/80 whitespace-nowrap">
                        {s.discount > 0 ? `− ${fmtCOP(s.discount)}` : '—'}
                      </td>
                      <td className="px-3 py-2">
                        {hasCustomer ? (
                          <div className="flex items-center gap-1.5 text-xs">
                            <UserRound className="w-3 h-3 text-nina-silver" />
                            <span className="truncate max-w-[120px]" title={s.customer.name}>
                              {s.customer.name}
                            </span>
                          </div>
                        ) : (
                          <span className="text-nina-mute">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button onClick={() => onCancel(s)} className="btn-danger !p-1.5">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </motion.tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </motion.div>

      <SaleModal open={open} onClose={() => setOpen(false)} />
    </div>
  )
}
