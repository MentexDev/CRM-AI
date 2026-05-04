import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import {
  seedProducts,
  seedSales,
  seedPrizes,
  emptySizes,
  SIZES,
} from '../lib/seed'

// v3 = arranque limpio (sin productos/premios demo)
const PRODUCTS_KEY = 'nina:products:v3'
const SALES_KEY = 'nina:sales:v3'
const PRIZES_KEY = 'nina:prizes:v2'

const load = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key)
    if (raw) return JSON.parse(raw)
  } catch {}
  localStorage.setItem(key, JSON.stringify(fallback))
  return fallback
}

const sumSizes = (sizes) =>
  Object.values(sizes || {}).reduce((a, b) => a + Number(b || 0), 0)

const emptyCustomer = () => ({
  name: 'NA',
  cedula: 'NA',
  address: 'NA',
  phone: 'NA',
  email: 'NA',
})

const DataContext = createContext(null)

export function DataProvider({ children }) {
  const [products, setProducts] = useState(() => load(PRODUCTS_KEY, seedProducts))
  const [sales, setSales] = useState(() => load(SALES_KEY, seedSales))
  const [prizes, setPrizes] = useState(() => load(PRIZES_KEY, seedPrizes))

  useEffect(() => localStorage.setItem(PRODUCTS_KEY, JSON.stringify(products)), [products])
  useEffect(() => localStorage.setItem(SALES_KEY, JSON.stringify(sales)), [sales])
  useEffect(() => localStorage.setItem(PRIZES_KEY, JSON.stringify(prizes)), [prizes])

  // ============= PRODUCTOS =============
  const upsertProduct = (p) => {
    const sizes = { ...emptySizes(), ...(p.sizes || {}) }
    setProducts((prev) => {
      const exists = prev.find((x) => x.id === p.id)
      if (exists) {
        // Si cambia inventario inicial, también ajustamos `sizes` actual
        // sumando la diferencia (para no perder ventas registradas)
        const initialSizes = { ...emptySizes(), ...(p.initialSizes || sizes) }
        const delta = {}
        for (const s of SIZES) {
          delta[s] = Number(initialSizes[s] || 0) - Number(exists.initialSizes?.[s] || 0)
        }
        const newSizes = { ...exists.sizes }
        for (const s of SIZES) {
          newSizes[s] = Math.max(0, Number(newSizes[s] || 0) + delta[s])
        }
        return prev.map((x) =>
          x.id === p.id ? { ...exists, ...p, initialSizes, sizes: newSizes } : x,
        )
      }
      // Nuevo producto: el inventario inicial = sizes ingresados
      const initialSizes = { ...sizes }
      return [...prev, { ...p, initialSizes, sizes }]
    })
  }

  const removeProduct = (id) => setProducts((prev) => prev.filter((p) => p.id !== id))

  // Ajusta inventario inicial de un producto/talla (uso en tabla Excel)
  const setInitialSize = (productId, size, qty) => {
    setProducts((prev) =>
      prev.map((p) => {
        if (p.id !== productId) return p
        const oldInitial = Number(p.initialSizes?.[size] || 0)
        const newInitial = Math.max(0, Number(qty) || 0)
        const oldStock = Number(p.sizes?.[size] || 0)
        // mantener la cantidad vendida constante
        const sold = Math.max(0, oldInitial - oldStock)
        const newStock = Math.max(0, newInitial - sold)
        return {
          ...p,
          initialSizes: { ...p.initialSizes, [size]: newInitial },
          sizes: { ...p.sizes, [size]: newStock },
        }
      }),
    )
  }

  // ============= VENTAS =============
  // Registra UN pedido con varias líneas. Devuelve array de sales creadas.
  // items = [{ productId, size, quantity }]
  // discount = COP total a descontar del pedido
  const registerOrder = ({
    sellerId,
    sellerName,
    items,
    paymentMethod = 'Efectivo',
    discount = 0,
    customer,
  }) => {
    if (!Array.isArray(items) || items.length === 0)
      throw new Error('Agrega al menos una venta al pedido')

    // Validamos stock antes de descontar nada
    const validated = items.map((it) => {
      const product = products.find((p) => p.id === it.productId)
      if (!product) throw new Error('Producto no encontrado')
      const available = Number(product.sizes?.[it.size] || 0)
      const qty = Number(it.quantity)
      if (!qty || qty < 1) throw new Error(`Cantidad inválida para ${product.name}`)
      if (available < qty)
        throw new Error(`Solo hay ${available} unidades de ${product.name} talla ${it.size}`)
      return { ...it, product, quantity: qty }
    })

    const subtotal = validated.reduce((a, v) => a + v.product.price * v.quantity, 0)
    const totalDiscount = Math.max(0, Math.min(Number(discount) || 0, subtotal))
    const orderId = `ord-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const soldAt = new Date().toISOString()
    const cust = { ...emptyCustomer(), ...(customer || {}) }

    // Reparto proporcional del descuento
    const newSales = validated.map((v, i) => {
      const lineSubtotal = v.product.price * v.quantity
      // última línea absorbe el remanente para evitar errores de redondeo
      const lineDiscount =
        i === validated.length - 1
          ? totalDiscount -
            validated
              .slice(0, -1)
              .reduce(
                (a, x) =>
                  a +
                  Math.round(((x.product.price * x.quantity) / subtotal) * totalDiscount),
                0,
              )
          : Math.round((lineSubtotal / subtotal) * totalDiscount)
      const lineTotal = lineSubtotal - lineDiscount
      return {
        id: `sale-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 5)}`,
        orderId,
        sellerId,
        sellerName,
        productId: v.product.id,
        productName: v.product.name,
        sku: v.product.sku,
        size: v.size,
        quantity: v.quantity,
        unitPrice: v.product.price,
        lineSubtotal,
        discount: lineDiscount,
        total: lineTotal,
        paymentMethod,
        customer: cust,
        soldAt,
      }
    })

    // Descontamos del stock todas las líneas
    setProducts((prev) =>
      prev.map((p) => {
        const lines = newSales.filter((s) => s.productId === p.id)
        if (lines.length === 0) return p
        const newSizes = { ...p.sizes }
        for (const l of lines) {
          newSizes[l.size] = Number(newSizes[l.size] || 0) - l.quantity
        }
        return { ...p, sizes: newSizes }
      }),
    )

    setSales((prev) => [...newSales, ...prev])
    return newSales
  }

  const cancelSale = (saleId) => {
    setSales((prev) => {
      const sale = prev.find((s) => s.id === saleId)
      if (sale) {
        setProducts((p) =>
          p.map((x) =>
            x.id === sale.productId
              ? {
                  ...x,
                  sizes: {
                    ...x.sizes,
                    [sale.size]: Number(x.sizes?.[sale.size] || 0) + sale.quantity,
                  },
                }
              : x,
          ),
        )
      }
      return prev.filter((s) => s.id !== saleId)
    })
  }

  // Cancela un pedido completo (todas sus líneas)
  const cancelOrder = (orderId) => {
    setSales((prev) => {
      const linesToCancel = prev.filter((s) => s.orderId === orderId)
      if (linesToCancel.length > 0) {
        setProducts((p) =>
          p.map((x) => {
            const mine = linesToCancel.filter((l) => l.productId === x.id)
            if (mine.length === 0) return x
            const newSizes = { ...x.sizes }
            for (const l of mine) {
              newSizes[l.size] = Number(newSizes[l.size] || 0) + l.quantity
            }
            return { ...x, sizes: newSizes }
          }),
        )
      }
      return prev.filter((s) => s.orderId !== orderId)
    })
  }

  // ============= PREMIOS =============
  const upsertPrize = (p) => {
    setPrizes((prev) => {
      const exists = prev.some((x) => x.id === p.id)
      const next = exists ? prev.map((x) => (x.id === p.id ? p : x)) : [...prev, p]
      return [...next].sort((a, b) => Number(a.threshold) - Number(b.threshold))
    })
  }
  const removePrize = (id) => setPrizes((prev) => prev.filter((p) => p.id !== id))
  const resetPrizes = () => setPrizes(seedPrizes)

  // ============= AGREGADOS =============
  const totalsBySeller = useMemo(() => {
    const map = {}
    for (const s of sales) {
      if (!map[s.sellerId]) map[s.sellerId] = { total: 0, units: 0, count: 0 }
      map[s.sellerId].total += s.total
      map[s.sellerId].units += s.quantity
      map[s.sellerId].count += 1
    }
    return map
  }, [sales])

  const totals = useMemo(() => {
    const total = sales.reduce((a, s) => a + s.total, 0)
    const units = sales.reduce((a, s) => a + s.quantity, 0)
    const count = sales.length
    return { total, units, count }
  }, [sales])

  // Cantidad vendida por (productId, size) — para inventario final
  const soldByProductSize = useMemo(() => {
    const map = {}
    for (const s of sales) {
      if (!map[s.productId]) map[s.productId] = {}
      map[s.productId][s.size] = (map[s.productId][s.size] || 0) + s.quantity
    }
    return map
  }, [sales])

  return (
    <DataContext.Provider
      value={{
        products,
        sales,
        prizes,
        upsertProduct,
        removeProduct,
        setInitialSize,
        registerOrder,
        cancelSale,
        cancelOrder,
        upsertPrize,
        removePrize,
        resetPrizes,
        totalsBySeller,
        totals,
        soldByProductSize,
        sumSizes,
      }}
    >
      {children}
    </DataContext.Provider>
  )
}

export const useData = () => useContext(DataContext)
