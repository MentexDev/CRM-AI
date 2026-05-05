import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { seedProducts, seedSales, seedPrizes, emptySizes, SIZES } from '../lib/seed'

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

// ---------- Mappers Supabase row → frontend shape ----------
const mapProduct = (r) => ({
  id: r.id,
  sku: r.sku,
  name: r.name,
  category: r.category,
  color: r.color,
  price: Number(r.price) || 0,
  cost: Number(r.cost) || 0,
  initialSizes: { ...emptySizes(), ...(r.initial_sizes || {}) },
  sizes: { ...emptySizes(), ...(r.sizes || {}) },
})

const mapSale = (r) => ({
  id: r.id,
  orderId: r.order_id,
  sellerId: r.seller_id,
  sellerName: r.seller_name,
  productId: r.product_id,
  productName: r.product_name,
  sku: r.sku,
  size: r.size,
  quantity: r.quantity,
  unitPrice: Number(r.unit_price) || 0,
  lineSubtotal: Number(r.line_subtotal) || 0,
  discount: Number(r.discount) || 0,
  total: Number(r.total) || 0,
  paymentMethod: r.payment_method,
  customer: {
    name: r.customer_name,
    cedula: r.customer_cedula,
    address: r.customer_address,
    phone: r.customer_phone,
    email: r.customer_email,
  },
  soldAt: r.sold_at,
})

const mapPrize = (r) => ({
  id: r.id,
  type: r.type,
  threshold: Number(r.threshold),
  name: r.name,
  icon: r.icon,
})

const DataContext = createContext(null)

export function DataProvider({ children }) {
  // Estado base
  const [products, setProducts] = useState(() =>
    isSupabaseConfigured ? [] : load(PRODUCTS_KEY, seedProducts),
  )
  const [sales, setSales] = useState(() =>
    isSupabaseConfigured ? [] : load(SALES_KEY, seedSales),
  )
  const [prizes, setPrizes] = useState(() =>
    isSupabaseConfigured ? [] : load(PRIZES_KEY, seedPrizes),
  )

  // Persistencia local cuando NO hay Supabase
  useEffect(() => {
    if (!isSupabaseConfigured) localStorage.setItem(PRODUCTS_KEY, JSON.stringify(products))
  }, [products])
  useEffect(() => {
    if (!isSupabaseConfigured) localStorage.setItem(SALES_KEY, JSON.stringify(sales))
  }, [sales])
  useEffect(() => {
    if (!isSupabaseConfigured) localStorage.setItem(PRIZES_KEY, JSON.stringify(prizes))
  }, [prizes])

  // ---------- Fetch unificado (lo usan tanto la carga inicial como el refetch
  //            tras mutaciones, por si el realtime tarda) ----------
  const fetchAll = useCallback(async () => {
    if (!isSupabaseConfigured) return
    const [pRes, sRes, prRes] = await Promise.all([
      supabase.from('products').select('*').order('created_at'),
      supabase.from('sales').select('*').order('sold_at', { ascending: false }),
      supabase.from('prizes').select('*').order('threshold'),
    ])
    if (pRes.error) console.error('[NINA] products fetch error:', pRes.error)
    if (sRes.error) console.error('[NINA] sales fetch error:', sRes.error)
    if (prRes.error) console.error('[NINA] prizes fetch error:', prRes.error)
    if (pRes.data) setProducts(pRes.data.map(mapProduct))
    if (sRes.data) setSales(sRes.data.map(mapSale))
    if (prRes.data) setPrizes(prRes.data.map(mapPrize))
  }, [])

  // ---------- Carga inicial + realtime cuando hay Supabase ----------
  useEffect(() => {
    if (!isSupabaseConfigured) return
    fetchAll()

    const channel = supabase
      .channel('data-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, fetchAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales' }, fetchAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'prizes' }, fetchAll)
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [fetchAll])

  // ============= PRODUCTOS =============
  const upsertProduct = useCallback(async (p) => {
    if (isSupabaseConfigured) {
      const initial = { ...emptySizes(), ...(p.initialSizes || p.sizes || {}) }
      const sizes = { ...emptySizes(), ...(p.sizes || initial) }
      const row = {
        sku: p.sku,
        name: p.name,
        category: p.category || null,
        color: p.color || null,
        price: Number(p.price) || 0,
        cost: Number(p.cost) || 0,
        initial_sizes: initial,
        sizes,
      }
      // Si nos pasan id válido (uuid existente) → update; si no, upsert por sku
      if (p.id && /^[0-9a-f]{8}-/i.test(p.id)) {
        const { error } = await supabase.from('products').update(row).eq('id', p.id)
        if (error) {
          console.error('[NINA] product update error:', error)
          throw error
        }
      } else {
        const { error } = await supabase
          .from('products')
          .upsert(row, { onConflict: 'sku' })
        if (error) {
          console.error('[NINA] product upsert error:', error)
          throw error
        }
      }
      await fetchAll()
      return
    }
    // Fallback local
    setProducts((prev) => {
      const exists = prev.find((x) => x.id === p.id)
      const sizes = { ...emptySizes(), ...(p.sizes || {}) }
      if (exists) {
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
      return [...prev, { ...p, initialSizes: { ...sizes }, sizes }]
    })
  }, [fetchAll])

  const removeProduct = useCallback(async (id) => {
    if (isSupabaseConfigured) {
      const { error } = await supabase.from('products').delete().eq('id', id)
      if (error) throw error
      await fetchAll()
      return
    }
    setProducts((prev) => prev.filter((p) => p.id !== id))
  }, [fetchAll])

  const setInitialSize = useCallback(async (productId, size, qty) => {
    if (isSupabaseConfigured) {
      const { error } = await supabase.rpc('set_initial_size', {
        p_product: productId,
        p_size: String(size),
        p_qty: Number(qty) || 0,
      })
      if (error) throw error
      await fetchAll()
      return
    }
    setProducts((prev) =>
      prev.map((p) => {
        if (p.id !== productId) return p
        const oldInitial = Number(p.initialSizes?.[size] || 0)
        const newInitial = Math.max(0, Number(qty) || 0)
        const oldStock = Number(p.sizes?.[size] || 0)
        const sold = Math.max(0, oldInitial - oldStock)
        const newStock = Math.max(0, newInitial - sold)
        return {
          ...p,
          initialSizes: { ...p.initialSizes, [size]: newInitial },
          sizes: { ...p.sizes, [size]: newStock },
        }
      }),
    )
  }, [fetchAll])

  // ============= VENTAS =============
  const registerOrder = useCallback(
    async ({ sellerId, sellerName, items, customer }) => {
      if (!Array.isArray(items) || items.length === 0)
        throw new Error('Agrega al menos una venta al pedido')

      if (isSupabaseConfigured) {
        const { data, error } = await supabase.rpc('register_order', {
          p_seller_id: sellerId,
          p_items: items.map((i) => ({
            product_id: i.productId,
            size: String(i.size),
            quantity: Number(i.quantity),
            discount_pct: Math.max(0, Math.min(100, Number(i.discountPct) || 0)),
            payment_method: i.paymentMethod || 'Efectivo',
          })),
          p_customer: { ...emptyCustomer(), ...(customer || {}) },
        })
        if (error) throw new Error(error.message || 'No se pudo registrar la venta')
        // Refetch inmediato (no esperamos al realtime, que a veces tarda 1-2s)
        await fetchAll()
        return (data || []).map(mapSale)
      }

      // Fallback local — descuento y método por línea
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
      const orderId = `ord-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      const soldAt = new Date().toISOString()
      const cust = { ...emptyCustomer(), ...(customer || {}) }

      const newSales = validated.map((v, i) => {
        const lineSubtotal = v.product.price * v.quantity
        const pct = Math.max(0, Math.min(100, Number(v.discountPct) || 0))
        const lineDiscount = Math.round((lineSubtotal * pct) / 100)
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
          total: lineSubtotal - lineDiscount,
          paymentMethod: v.paymentMethod || 'Efectivo',
          customer: cust,
          soldAt,
        }
      })
      setProducts((prev) =>
        prev.map((p) => {
          const lines = newSales.filter((s) => s.productId === p.id)
          if (lines.length === 0) return p
          const newSizes = { ...p.sizes }
          for (const l of lines) newSizes[l.size] = Number(newSizes[l.size] || 0) - l.quantity
          return { ...p, sizes: newSizes }
        }),
      )
      setSales((prev) => [...newSales, ...prev])
      return newSales
    },
    [products],
  )

  const cancelSale = useCallback(async (saleId) => {
    if (isSupabaseConfigured) {
      const { error } = await supabase.rpc('cancel_sale', { p_sale: saleId })
      if (error) throw error
      await fetchAll()
      return
    }
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
  }, [fetchAll])

  const cancelOrder = useCallback(async (orderId) => {
    if (isSupabaseConfigured) {
      const { error } = await supabase.rpc('cancel_order', { p_order: orderId })
      if (error) throw error
      await fetchAll()
      return
    }
    setSales((prev) => {
      const linesToCancel = prev.filter((s) => s.orderId === orderId)
      if (linesToCancel.length > 0) {
        setProducts((p) =>
          p.map((x) => {
            const mine = linesToCancel.filter((l) => l.productId === x.id)
            if (mine.length === 0) return x
            const newSizes = { ...x.sizes }
            for (const l of mine) newSizes[l.size] = Number(newSizes[l.size] || 0) + l.quantity
            return { ...x, sizes: newSizes }
          }),
        )
      }
      return prev.filter((s) => s.orderId !== orderId)
    })
  }, [fetchAll])

  // ============= PREMIOS =============
  const upsertPrize = useCallback(async (p) => {
    if (isSupabaseConfigured) {
      const row = {
        type: p.type === 'units' ? 'units' : 'amount',
        threshold: Number(p.threshold) || 0,
        name: p.name,
        icon: p.icon,
      }
      if (p.id && /^[0-9a-f]{8}-/i.test(p.id)) {
        const { error } = await supabase.from('prizes').update(row).eq('id', p.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('prizes').insert(row)
        if (error) throw error
      }
      await fetchAll()
      return
    }
    setPrizes((prev) => {
      const exists = prev.some((x) => x.id === p.id)
      const next = exists ? prev.map((x) => (x.id === p.id ? p : x)) : [...prev, p]
      return [...next].sort((a, b) => Number(a.threshold) - Number(b.threshold))
    })
  }, [fetchAll])

  const removePrize = useCallback(async (id) => {
    if (isSupabaseConfigured) {
      const { error } = await supabase.from('prizes').delete().eq('id', id)
      if (error) throw error
      await fetchAll()
      return
    }
    setPrizes((prev) => prev.filter((p) => p.id !== id))
  }, [fetchAll])

  const resetPrizes = useCallback(async () => {
    if (isSupabaseConfigured) {
      const { error } = await supabase.from('prizes').delete().neq('id', '00000000-0000-0000-0000-000000000000')
      if (error) throw error
      await fetchAll()
      return
    }
    setPrizes(seedPrizes)
  }, [fetchAll])

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
