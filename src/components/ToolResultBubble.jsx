import { motion } from 'framer-motion'
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Database,
  Package,
  ShoppingBag,
  Store,
  Users,
  Wrench,
} from 'lucide-react'

const fmtMoney = (n, currency = 'COP') => {
  if (n == null || isNaN(Number(n))) return '—'
  try {
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(n))
  } catch {
    return `${n} ${currency}`
  }
}

const truncate = (s, n = 60) =>
  s == null ? '' : String(s).length > n ? String(s).slice(0, n) + '…' : String(s)

/**
 * Renderiza el resultado de una tool de manera legible. Si reconoce un
 * formato conocido (productos, órdenes, clientes, etc.) muestra cards
 * compactas; si no, muestra un summary + JSON colapsable.
 */
export default function ToolResultBubble({ message }) {
  let parsed = null
  try {
    parsed = JSON.parse(message.content || '{}')
  } catch {
    parsed = { _raw: message.content }
  }
  const ok = parsed?.ok === true

  if (!ok) {
    return (
      <Wrap kind="error">
        <Header
          icon={<AlertCircle className="w-3.5 h-3.5" />}
          title="Tool falló"
          subtitle={parsed?.error || 'Error desconocido'}
          tone="error"
        />
      </Wrap>
    )
  }

  const data = parsed.data ?? {}

  // Productos de Shopify
  if (Array.isArray(data.products)) {
    return (
      <Wrap kind="ok">
        <Header
          icon={<ShoppingBag className="w-3.5 h-3.5" />}
          title={`${data.count ?? data.products.length} producto${data.products.length === 1 ? '' : 's'}`}
          subtitle={data.query ? `query: ${data.query}` : 'sin filtros'}
        />
        <ProductList products={data.products.slice(0, 6)} />
        {data.products.length > 6 && (
          <Tail label={`+${data.products.length - 6} más en el JSON ↓`} />
        )}
        <RawJson data={data} />
      </Wrap>
    )
  }

  // Órdenes de Shopify
  if (Array.isArray(data.orders)) {
    return (
      <Wrap kind="ok">
        <Header
          icon={<Package className="w-3.5 h-3.5" />}
          title={`${data.count ?? data.orders.length} órden${data.orders.length === 1 ? '' : 'es'}`}
          subtitle={
            data.filters?.since
              ? `desde ${data.filters.since}${data.filters.status ? ` · ${data.filters.status}` : ''}`
              : data.filters?.status || 'todas'
          }
        />
        {data.orders.length > 0 ? (
          <OrderList orders={data.orders.slice(0, 5)} />
        ) : (
          <div className="text-[11px] text-nina-mute italic px-1 py-1">
            Sin órdenes para esos filtros.
          </div>
        )}
        {data.orders.length > 5 && (
          <Tail label={`+${data.orders.length - 5} más en el JSON ↓`} />
        )}
        <RawJson data={data} />
      </Wrap>
    )
  }

  // Clientes de Shopify
  if (Array.isArray(data.customers)) {
    return (
      <Wrap kind="ok">
        <Header
          icon={<Users className="w-3.5 h-3.5" />}
          title={`${data.count ?? data.customers.length} cliente${data.customers.length === 1 ? '' : 's'}`}
          subtitle={data.query || 'sin filtros'}
        />
        <CustomerList customers={data.customers.slice(0, 6)} />
        {data.customers.length > 6 && (
          <Tail label={`+${data.customers.length - 6} más en el JSON ↓`} />
        )}
        <RawJson data={data} />
      </Wrap>
    )
  }

  // Shop summary
  if (data.myshopify_domain || data.primary_url) {
    return (
      <Wrap kind="ok">
        <Header
          icon={<Store className="w-3.5 h-3.5" />}
          title={data.name || 'Tienda'}
          subtitle={[data.country, data.currency, data.plan].filter(Boolean).join(' · ')}
        />
        <div className="text-[11px] text-nina-mute font-mono">
          {data.myshopify_domain}
        </div>
      </Wrap>
    )
  }

  // KPIs
  if (Array.isArray(data.kpis)) {
    return (
      <Wrap kind="ok">
        <Header
          icon={<Database className="w-3.5 h-3.5" />}
          title={`${data.kpis.length} métrica${data.kpis.length === 1 ? '' : 's'}`}
          subtitle={data.note}
        />
        <RawJson data={data} />
      </Wrap>
    )
  }

  // Memory matches (búsqueda en memoria)
  if (Array.isArray(data.matches)) {
    return (
      <Wrap kind="ok">
        <Header
          icon={<Database className="w-3.5 h-3.5" />}
          title={`${data.matches.length} memoria${data.matches.length === 1 ? '' : 's'}`}
          subtitle={data.note}
        />
        {data.matches.slice(0, 3).map((m) => (
          <div key={m.id} className="text-[11px] text-nina-chrome border-l border-nina-line/60 pl-2 py-0.5">
            <span className="text-nina-mute mr-1">[{m.kind}]</span>
            {truncate(m.content, 140)}
          </div>
        ))}
        {data.matches.length > 0 && <RawJson data={data} />}
      </Wrap>
    )
  }

  // Atajo: task_id → tarea cerrada
  if (data.task_id && data.status) {
    return (
      <Wrap kind="ok">
        <Header
          icon={<CheckCircle2 className="w-3.5 h-3.5" />}
          title={`Tarea ${data.status}`}
          subtitle={`id: ${truncate(data.task_id, 12)}…`}
        />
      </Wrap>
    )
  }

  // Atajo: task creada por delegación
  if (data.task_id && data.assigned_to) {
    return (
      <Wrap kind="ok">
        <Header
          icon={<CheckCircle2 className="w-3.5 h-3.5" />}
          title={`Tarea delegada a ${data.assigned_to}`}
          subtitle={`id: ${truncate(data.task_id, 12)}…`}
        />
      </Wrap>
    )
  }

  // Atajo: aprobación creada
  if (data.approval_id) {
    return (
      <Wrap kind="ok">
        <Header
          icon={<Clock className="w-3.5 h-3.5" />}
          title="Aprobación pendiente"
          subtitle={`Tu tarea queda bloqueada hasta que la Junta decida`}
          tone="pending"
        />
      </Wrap>
    )
  }

  // Atajo: memory guardada
  if (data.memory_id) {
    return (
      <Wrap kind="ok">
        <Header
          icon={<Database className="w-3.5 h-3.5" />}
          title="Memoria guardada"
          subtitle={`id: ${truncate(data.memory_id, 12)}…`}
        />
      </Wrap>
    )
  }

  // Default: bubble genérico con JSON colapsable
  return (
    <Wrap kind="ok">
      <Header icon={<Wrench className="w-3.5 h-3.5" />} title="Tool ejecutada" />
      <RawJson data={data} />
    </Wrap>
  )
}

// =====================================================================
// Helpers visuales
// =====================================================================

function Wrap({ kind, children }) {
  const tone =
    kind === 'error'
      ? 'bg-red-500/10 border-red-500/20 text-red-200'
      : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-100'
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex justify-center"
    >
      <div className={`max-w-[88%] sm:max-w-[78%] rounded-xl px-3 py-2 text-[11px] border space-y-2 ${tone}`}>
        {children}
      </div>
    </motion.div>
  )
}

function Header({ icon, title, subtitle, tone }) {
  const titleColor = tone === 'error' ? 'text-red-200' : tone === 'pending' ? 'text-amber-200' : 'text-emerald-100'
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 flex-shrink-0">{icon}</span>
      <div className="min-w-0">
        <div className={`text-[11.5px] font-medium ${titleColor}`}>{title}</div>
        {subtitle && <div className="text-[10.5px] opacity-75 mt-0.5">{subtitle}</div>}
      </div>
    </div>
  )
}

function Tail({ label }) {
  return <div className="text-[10.5px] opacity-60 italic px-1">{label}</div>
}

function RawJson({ data }) {
  return (
    <details className="mt-1 group">
      <summary className="text-[10px] uppercase tracking-[0.18em] opacity-60 cursor-pointer hover:opacity-90 select-none">
        ver JSON
      </summary>
      <pre className="whitespace-pre-wrap break-words font-mono text-[10.5px] opacity-90 mt-2 bg-nina-black/30 p-2 rounded-md max-h-60 overflow-y-auto">
        {JSON.stringify(data, null, 2)}
      </pre>
    </details>
  )
}

function ProductList({ products }) {
  return (
    <div className="space-y-1.5">
      {products.map((p) => (
        <div
          key={p.id}
          className="flex items-center justify-between gap-2 rounded-md bg-nina-black/30 border border-nina-line/40 px-2 py-1.5"
        >
          <div className="min-w-0 flex-1">
            <div className="text-[11.5px] text-nina-chrome truncate">{p.title}</div>
            <div className="text-[10px] opacity-60 truncate">
              {p.product_type} · stock {p.total_inventory}
            </div>
          </div>
          <div className="text-[11px] font-mono text-nina-chrome flex-shrink-0">
            {fmtMoney(p.price_min, p.currency)}
          </div>
        </div>
      ))}
    </div>
  )
}

function OrderList({ orders }) {
  return (
    <div className="space-y-1.5">
      {orders.map((o) => (
        <div
          key={o.id}
          className="flex items-center justify-between gap-2 rounded-md bg-nina-black/30 border border-nina-line/40 px-2 py-1.5"
        >
          <div className="min-w-0 flex-1">
            <div className="text-[11.5px] text-nina-chrome truncate">
              {o.name} · {o.customer_name || 'sin cliente'}
            </div>
            <div className="text-[10px] opacity-60 truncate">
              {o.financial_status} · {(o.items || []).length} items
            </div>
          </div>
          <div className="text-[11px] font-mono text-nina-chrome flex-shrink-0">
            {fmtMoney(o.total, o.currency)}
          </div>
        </div>
      ))}
    </div>
  )
}

function CustomerList({ customers }) {
  return (
    <div className="space-y-1.5">
      {customers.map((c) => (
        <div
          key={c.id}
          className="flex items-center justify-between gap-2 rounded-md bg-nina-black/30 border border-nina-line/40 px-2 py-1.5"
        >
          <div className="min-w-0 flex-1">
            <div className="text-[11.5px] text-nina-chrome truncate">{c.name || c.email}</div>
            <div className="text-[10px] opacity-60 truncate">
              {c.email} · {c.orders_count} órdenes
            </div>
          </div>
          <div className="text-[11px] font-mono text-nina-chrome flex-shrink-0">
            {fmtMoney(c.total_spent, c.currency)}
          </div>
        </div>
      ))}
    </div>
  )
}
