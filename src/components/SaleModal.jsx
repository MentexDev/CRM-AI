import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CheckCircle2, Plus, Trash2, UserRound } from 'lucide-react'
import toast from 'react-hot-toast'
import Modal from './Modal'
import { useAuth } from '../context/AuthContext'
import { useData } from '../context/DataContext'
import { fmtCOP } from '../lib/format'
import { PAYMENT_METHODS, SIZES } from '../lib/seed'

const newLine = () => ({
  id: Math.random().toString(36).slice(2, 9),
  productId: '',
  size: '',
  quantity: 1,
  discountPct: 0,
  paymentMethod: 'Efectivo',
})

const emptyCustomer = {
  name: 'NA',
  cedula: 'NA',
  address: 'NA',
  phone: 'NA',
  email: 'NA',
}

const calcLineTotal = (product, line) => {
  if (!product) return { subtotal: 0, discount: 0, total: 0 }
  const qty = Number(line.quantity) || 0
  const subtotal = product.price * qty
  const pct = Math.max(0, Math.min(100, Number(line.discountPct) || 0))
  const discount = Math.round((subtotal * pct) / 100)
  return { subtotal, discount, total: Math.max(0, subtotal - discount) }
}

export default function SaleModal({ open, onClose, fixedSellerId }) {
  const { user, listSellers } = useAuth()
  const { products, registerOrder } = useData()
  const sellers = listSellers().filter((s) => s.role === 'seller')

  const [sellerId, setSellerId] = useState(fixedSellerId || user?.id || '')
  const [items, setItems] = useState([newLine()])
  const [showCustomer, setShowCustomer] = useState(false)
  const [customer, setCustomer] = useState(emptyCustomer)
  const [busy, setBusy] = useState(false)

  // Cuando se abre el modal, reseteamos el estado
  useEffect(() => {
    if (open) {
      setSellerId(fixedSellerId || user?.id || '')
      setItems([newLine()])
      setShowCustomer(false)
      setCustomer(emptyCustomer)
    }
  }, [open, fixedSellerId, user?.id])

  const addLine = () =>
    setItems((p) => {
      // hereda método de pago de la línea anterior por comodidad
      const last = p[p.length - 1]
      const fresh = newLine()
      if (last) fresh.paymentMethod = last.paymentMethod
      return [...p, fresh]
    })
  const removeLine = (id) =>
    setItems((p) => (p.length === 1 ? p : p.filter((x) => x.id !== id)))

  const updateLine = (id, patch) =>
    setItems((p) =>
      p.map((it) =>
        it.id === id
          ? {
              ...it,
              ...patch,
              ...(patch.productId !== undefined && patch.productId !== it.productId
                ? { size: '', quantity: 1 }
                : {}),
            }
          : it,
      ),
    )

  const totals = useMemo(() => {
    let subtotal = 0
    let discount = 0
    let total = 0
    let units = 0
    for (const it of items) {
      const product = products.find((p) => p.id === it.productId)
      const t = calcLineTotal(product, it)
      subtotal += t.subtotal
      discount += t.discount
      total += t.total
      units += Number(it.quantity) || 0
    }
    return { subtotal, discount, total, units }
  }, [items, products])

  const submit = async () => {
    if (!sellerId) return toast.error('Selecciona la vendedora')
    if (!items.length) return toast.error('Agrega al menos una venta')
    if (items.some((it) => !it.productId)) return toast.error('Hay líneas sin producto')
    if (items.some((it) => !it.size)) return toast.error('Hay líneas sin talla')
    if (items.some((it) => Number(it.quantity) < 1))
      return toast.error('Cantidad inválida')

    const seller =
      sellers.find((s) => s.id === sellerId) ||
      (user?.id === sellerId ? user : null)
    if (!seller) return toast.error('Vendedora no encontrada')

    setBusy(true)
    try {
      const result = await registerOrder({
        sellerId: seller.id,
        sellerName: seller.name,
        items: items.map((it) => ({
          productId: it.productId,
          size: it.size,
          quantity: Number(it.quantity),
          discountPct: Math.max(0, Math.min(100, Number(it.discountPct) || 0)),
          paymentMethod: it.paymentMethod || 'Efectivo',
        })),
        customer: showCustomer ? customer : emptyCustomer,
      })
      toast.success(
        result.length === 1
          ? `Venta registrada · ${fmtCOP(result[0].total)}`
          : `${result.length} ventas registradas · ${fmtCOP(totals.total)}`,
      )
      onClose()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Registrar venta" maxWidth="max-w-3xl">
      <div className="space-y-5">
        {/* Vendedora (solo si admin) */}
        {!fixedSellerId && (
          <div>
            <label className="label">Vendedora</label>
            <select
              className="input"
              value={sellerId}
              onChange={(e) => setSellerId(e.target.value)}
            >
              <option value="">Selecciona…</option>
              {sellers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Líneas de venta */}
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <span className="label mb-0">Productos del pedido</span>
            <span className="text-[11px] text-nina-mute">
              {items.length} {items.length === 1 ? 'línea' : 'líneas'} ·{' '}
              {totals.units} {totals.units === 1 ? 'unidad' : 'unidades'}
            </span>
          </div>
          <AnimatePresence initial={false}>
            {items.map((it, idx) => (
              <SaleLine
                key={it.id}
                index={idx}
                line={it}
                products={products}
                onChange={(patch) => updateLine(it.id, patch)}
                onRemove={() => removeLine(it.id)}
                canRemove={items.length > 1}
              />
            ))}
          </AnimatePresence>
          <button
            type="button"
            onClick={addLine}
            className="w-full mt-2 flex items-center justify-center gap-2 py-2.5 rounded-xl border border-dashed border-nina-line text-nina-mute hover:text-nina-chrome hover:border-nina-silver/40 transition text-sm"
          >
            <Plus className="w-4 h-4" />
            Añadir otra venta
          </button>
        </div>

        {/* Datos del cliente (colapsable) */}
        <div className="border-t border-nina-line pt-4">
          <button
            type="button"
            onClick={() => setShowCustomer((v) => !v)}
            className="flex items-center gap-2 text-sm text-nina-chrome hover:text-white transition"
          >
            <UserRound className="w-4 h-4" />
            <span>Datos del cliente (opcional)</span>
            <span className="text-[11px] text-nina-mute">
              {showCustomer ? '— ocultar' : '— click para agregar'}
            </span>
          </button>

          <AnimatePresence>
            {showCustomer && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="grid sm:grid-cols-2 gap-3 pt-4">
                  {[
                    ['name', 'Nombre'],
                    ['cedula', 'Cédula'],
                    ['phone', 'Celular'],
                    ['email', 'Correo'],
                  ].map(([k, label]) => (
                    <div key={k}>
                      <label className="label">{label}</label>
                      <input
                        className="input"
                        value={customer[k]}
                        onChange={(e) =>
                          setCustomer({ ...customer, [k]: e.target.value })
                        }
                      />
                    </div>
                  ))}
                  <div className="sm:col-span-2">
                    <label className="label">Dirección</label>
                    <input
                      className="input"
                      value={customer.address}
                      onChange={(e) =>
                        setCustomer({ ...customer, address: e.target.value })
                      }
                    />
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Resumen total */}
        <div className="rounded-xl bg-nina-ink border border-nina-line p-4 space-y-1">
          <div className="flex justify-between text-sm text-nina-mute">
            <span>Subtotal</span>
            <span>{fmtCOP(totals.subtotal)}</span>
          </div>
          {totals.discount > 0 && (
            <div className="flex justify-between text-sm text-amber-300/80">
              <span>Descuentos</span>
              <span>− {fmtCOP(totals.discount)}</span>
            </div>
          )}
          <div className="flex justify-between items-baseline pt-2 border-t border-nina-line">
            <span className="text-[11px] uppercase tracking-[0.2em] text-nina-mute">
              Total a cobrar
            </span>
            <span className="silver-text font-display text-2xl font-bold">
              {fmtCOP(totals.total)}
            </span>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn-ghost" disabled={busy}>
            Cancelar
          </button>
          <button onClick={submit} className="btn-primary" disabled={busy}>
            <CheckCircle2 className="w-4 h-4" />
            {busy ? 'Registrando…' : 'Confirmar venta'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function SaleLine({ index, line, products, onChange, onRemove, canRemove }) {
  const product = products.find((p) => p.id === line.productId)
  const { subtotal, discount, total } = calcLineTotal(product, line)
  const pct = Math.max(0, Math.min(100, Number(line.discountPct) || 0))

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.18 }}
      className="rounded-xl border border-nina-line bg-nina-ink/50 p-3 space-y-2"
    >
      {/* Fila 1: producto + talla + cantidad + eliminar */}
      <div className="grid grid-cols-12 gap-2 items-end">
        <div className="col-span-12 sm:col-span-6">
          <label className="text-[10px] uppercase tracking-[0.18em] text-nina-mute">
            #{index + 1} · Referencia
          </label>
          <select
            className="input mt-1"
            value={line.productId}
            onChange={(e) => onChange({ productId: e.target.value })}
          >
            <option value="">Selecciona producto…</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.sku} · {p.name}
              </option>
            ))}
          </select>
        </div>

        <div className="col-span-5 sm:col-span-3">
          <label className="text-[10px] uppercase tracking-[0.18em] text-nina-mute">
            Talla
          </label>
          <select
            className="input mt-1"
            value={line.size}
            onChange={(e) => onChange({ size: e.target.value })}
            disabled={!product}
          >
            <option value="">—</option>
            {SIZES.map((s) => {
              const stock = Number(product?.sizes?.[s] || 0)
              return (
                <option key={s} value={s} disabled={stock === 0}>
                  {s} {stock === 0 ? '(agotada)' : `(${stock})`}
                </option>
              )
            })}
          </select>
        </div>

        <div className="col-span-5 sm:col-span-2">
          <label className="text-[10px] uppercase tracking-[0.18em] text-nina-mute">
            Cant.
          </label>
          <input
            type="number"
            min="1"
            className="input mt-1 text-center"
            value={line.quantity}
            onChange={(e) => onChange({ quantity: e.target.value })}
          />
        </div>

        <div className="col-span-2 sm:col-span-1 flex justify-end">
          <button
            type="button"
            onClick={onRemove}
            disabled={!canRemove}
            className="btn-danger !p-2"
            title="Quitar línea"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Fila 2: pago + descuento (solo si hay producto seleccionado) */}
      {product && line.size && (
        <div className="grid grid-cols-12 gap-2 items-end pt-2 border-t border-nina-line/60">
          <div className="col-span-12 sm:col-span-5">
            <label className="text-[10px] uppercase tracking-[0.18em] text-nina-mute">
              Forma de pago
            </label>
            <select
              className="input mt-1"
              value={line.paymentMethod}
              onChange={(e) => onChange({ paymentMethod: e.target.value })}
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </div>

          <div className="col-span-7 sm:col-span-3">
            <label className="text-[10px] uppercase tracking-[0.18em] text-nina-mute">
              Descuento
            </label>
            <div className="relative mt-1">
              <input
                type="number"
                min="0"
                max="100"
                step="1"
                className="input pr-8 text-center"
                value={line.discountPct}
                onChange={(e) => onChange({ discountPct: e.target.value })}
                placeholder="0"
              />
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-nina-mute text-xs">
                %
              </span>
            </div>
          </div>

          <div className="col-span-5 sm:col-span-4 text-right">
            <div className="text-[10px] uppercase tracking-[0.18em] text-nina-mute">
              Total línea
            </div>
            <div className="silver-text font-display text-lg font-semibold leading-tight">
              {fmtCOP(total)}
            </div>
            {pct > 0 && (
              <div className="text-[10px] text-amber-300/80">
                {fmtCOP(subtotal)} − {pct}%
              </div>
            )}
          </div>
        </div>
      )}
    </motion.div>
  )
}
