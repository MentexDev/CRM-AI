import { Children, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { supabase } from '../lib/supabase'
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Clock,
  Database,
  ExternalLink,
  Globe,
  ImageIcon,
  Loader2,
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

  // Web search (Tavily). El distintivo: tiene `query` + `results` con
  // `url`+`title`+`content`, y opcionalmente un `answer` sintetizado.
  if (data.query && Array.isArray(data.results) && data.results[0]?.url && data.results[0]?.title) {
    return (
      <Wrap kind="ok">
        <Header
          icon={<Globe className="w-3.5 h-3.5" />}
          title={`${data.results.length} resultado${data.results.length === 1 ? '' : 's'}`}
          subtitle={`query: ${truncate(data.query, 80)}`}
        />
        {data.answer && (
          <div className="rounded-md bg-nina-black/30 border border-emerald-500/20 px-3 py-2 text-[11.5px] leading-relaxed text-emerald-100/95">
            <div className="text-[9px] uppercase tracking-[0.2em] opacity-60 mb-1">Resumen</div>
            {truncate(data.answer, 320)}
          </div>
        )}
        <SearchResultList results={data.results.slice(0, 5)} />
        {data.results.length > 5 && <Tail label={`+${data.results.length - 5} más en el JSON ↓`} />}
        <RawJson data={data} />
      </Wrap>
    )
  }

  // Imágenes generadas (Higgsfield)
  if (Array.isArray(data.images) && data.images.length > 0 && (data.images[0]?.url || typeof data.images[0] === 'string')) {
    return (
      <Wrap kind="ok">
        <Header
          icon={<ImageIcon className="w-3.5 h-3.5" />}
          title={`${data.images.length} imagen${data.images.length === 1 ? '' : 'es'} generada${data.images.length === 1 ? '' : 's'}`}
          subtitle={data.aspect_ratio ? `aspect ${data.aspect_ratio}` : null}
        />
        <ImageGrid images={data.images} />
        {data.prompt && (
          <div className="text-[11px] opacity-70 italic border-l border-emerald-500/30 pl-2">
            “{truncate(data.prompt, 200)}”
          </div>
        )}
        <RawJson data={data} />
      </Wrap>
    )
  }

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

  // Atajo: aprobación creada → estado EN VIVO. Al aprobar/rechazar en el panel, esta
  // burbuja pasa sola a "Aprobado/Rechazado" (sin que el usuario le avise al agente).
  if (data.approval_id) {
    return <ApprovalBubble approvalId={data.approval_id} />
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

// Burbuja de aprobación con estado EN VIVO: lee el approval y se suscribe a sus
// cambios. Cuando la Junta decide en el panel (status → approved/rejected), esta línea
// se actualiza sola en el chat — el resultado y el cierre del agente llegan por aparte.
function ApprovalBubble({ approvalId }) {
  const [status, setStatus] = useState('pending')

  useEffect(() => {
    if (!approvalId) return
    let active = true
    supabase
      .from('approvals')
      .select('status')
      .eq('id', approvalId)
      .maybeSingle()
      .then(({ data }) => {
        if (active && data?.status) setStatus(data.status)
      })
    const ch = supabase
      .channel(`approval-${approvalId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'approvals', filter: `id=eq.${approvalId}` },
        (payload) => {
          if (active && payload.new?.status) setStatus(payload.new.status)
        },
      )
      .subscribe()
    return () => {
      active = false
      try {
        supabase.removeChannel(ch)
      } catch {}
    }
  }, [approvalId])

  if (status === 'approved') {
    return (
      <Wrap kind="ok">
        <Header
          icon={<CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
          title="Aprobado por la Junta"
          subtitle="El agente continúa"
        />
      </Wrap>
    )
  }
  if (status === 'rejected') {
    return (
      <Wrap kind="error">
        <Header icon={<AlertCircle className="w-3.5 h-3.5" />} title="Rechazado por la Junta" subtitle="No se ejecutó" />
      </Wrap>
    )
  }
  return (
    <Wrap kind="ok">
      <Header
        icon={<Clock className="w-3.5 h-3.5" />}
        title="Aprobación pendiente"
        subtitle="Esperando la decisión de la Junta…"
      />
    </Wrap>
  )
}

// =====================================================================
// Helpers visuales
// =====================================================================

// Línea sutil colapsable (estilo Manus): el primer hijo (Header) es el
// resumen siempre visible; el resto se muestra al expandir.
function Wrap({ kind, children }) {
  const arr = Children.toArray(children).filter(Boolean)
  const [head, ...rest] = arr
  const hasDetail = rest.length > 0
  const tone = kind === 'error' ? 'text-red-300/80' : 'text-nina-mute'

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex justify-start"
    >
      <details className="group max-w-[90%] sm:max-w-[80%]">
        <summary
          className={`flex items-center gap-1.5 py-0.5 text-[11.5px] cursor-pointer select-none list-none transition hover:text-nina-chrome ${tone}`}
        >
          {head}
          {hasDetail && (
            <ChevronRight className="w-3 h-3 shrink-0 opacity-50 transition group-open:rotate-90" />
          )}
        </summary>
        {hasDetail && <div className="mt-1.5 ml-5 space-y-2 text-[11px] text-nina-chrome">{rest}</div>}
      </details>
    </motion.div>
  )
}

function Header({ icon, title, subtitle }) {
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0">
      <span className="shrink-0 opacity-70">{icon}</span>
      <span className="font-medium truncate">{title}</span>
      {subtitle && (
        <span className="opacity-60 truncate hidden sm:inline">· {truncate(subtitle, 48)}</span>
      )}
    </span>
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

// Sólo permite http(s). Neutraliza esquemas peligrosos (javascript:, data:)
// en URLs que vienen de resultados del backend (datos no confiables) — CWE-601/79.
function safeHref(url) {
  return /^https?:\/\//i.test(url || '') ? url : '#'
}

function GeneratedImage({ url, index }) {
  const [state, setState] = useState('loading') // 'loading' | 'loaded' | 'error'
  return (
    <a
      href={safeHref(url)}
      target="_blank"
      rel="noopener noreferrer"
      className="group block relative rounded-lg overflow-hidden border border-emerald-500/20 bg-nina-black/40 hover:border-emerald-400/60 transition min-h-[140px]"
      title="Abrir imagen original"
    >
      {state === 'loading' && (
        <div className="absolute inset-0 grid place-items-center text-emerald-200/70 z-10">
          <div className="text-center space-y-2">
            <Loader2 className="w-4 h-4 animate-spin mx-auto" />
            <div className="text-[10px] uppercase tracking-[0.18em]">Generando…</div>
            <div className="text-[9px] opacity-60">puede tardar 10-30s</div>
          </div>
        </div>
      )}
      {state === 'error' && (
        <div className="absolute inset-0 grid place-items-center text-red-200 z-10 px-3 text-center">
          <div className="space-y-1">
            <AlertCircle className="w-4 h-4 mx-auto" />
            <div className="text-[10px]">No se pudo cargar la imagen</div>
            <div className="text-[9px] opacity-60 break-all">{url.slice(0, 80)}…</div>
          </div>
        </div>
      )}
      <img
        src={url}
        alt={`Generación ${index + 1}`}
        referrerPolicy="no-referrer"
        onLoad={() => setState('loaded')}
        onError={() => setState('error')}
        className={`w-full h-auto block transition-opacity duration-300 ${state === 'loaded' ? 'opacity-100' : 'opacity-0'}`}
        style={{ minHeight: state === 'loaded' ? 'auto' : '200px' }}
      />
      {state === 'loaded' && (
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition flex items-end justify-end p-2 opacity-0 group-hover:opacity-100">
          <span className="text-[10px] uppercase tracking-[0.18em] bg-black/70 text-emerald-200 px-2 py-1 rounded-full">
            abrir ↗
          </span>
        </div>
      )}
    </a>
  )
}

function ImageGrid({ images }) {
  // Acepta tanto Array<{url}> como Array<string>
  const urls = images.map((img) => (typeof img === 'string' ? img : img?.url)).filter(Boolean)
  const cols = urls.length === 1 ? 'grid-cols-1' : 'grid-cols-2'
  return (
    <div className={`grid ${cols} gap-2`}>
      {urls.map((url, i) => (
        <GeneratedImage key={i} url={url} index={i} />
      ))}
    </div>
  )
}

function SearchResultList({ results }) {
  const host = (u) => {
    try {
      return new URL(u).hostname.replace(/^www\./, '')
    } catch {
      return u
    }
  }
  return (
    <div className="space-y-1.5">
      {results.map((r, i) => (
        <a
          key={i}
          href={safeHref(r.url)}
          target="_blank"
          rel="noopener noreferrer"
          className="block rounded-md bg-nina-black/30 border border-nina-line/40 px-2.5 py-2 hover:border-emerald-400/40 transition group"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-[11.5px] text-nina-chrome leading-snug group-hover:text-emerald-200 transition truncate">
                {r.title}
              </div>
              <div className="text-[10px] text-emerald-300/80 truncate font-mono mt-0.5">
                {host(r.url)}
                {r.published_date && (
                  <span className="ml-1.5 opacity-60">· {r.published_date.slice(0, 10)}</span>
                )}
              </div>
            </div>
            <ExternalLink className="w-3 h-3 mt-0.5 flex-shrink-0 opacity-50 group-hover:opacity-100 transition" />
          </div>
          {r.content && (
            <div className="text-[11px] text-nina-mute leading-snug mt-1.5 line-clamp-3">
              {r.content}
            </div>
          )}
        </a>
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
