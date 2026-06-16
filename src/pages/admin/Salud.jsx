import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Activity, AlertTriangle, CheckCircle2, Coins, Loader2, RefreshCw, Wrench } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

// F5 · Salud del Motor — panel de observabilidad (junta-only). Lee engine_health().
const TASK_LABELS = {
  to_do: 'Por hacer',
  in_progress: 'En progreso',
  blocked: 'Bloqueadas',
  needs_review: 'Para revisar',
  done: 'Hechas',
  cancelled: 'Canceladas',
}
const TASK_ORDER = ['to_do', 'in_progress', 'blocked', 'needs_review', 'done', 'cancelled']
const STATUS_DOT = {
  idle: 'bg-nina-mute',
  running: 'bg-emerald-400',
  disabled: 'bg-red-400/70',
}

export default function Salud() {
  const { isJunta } = useAuth()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    const { data: res, error } = await supabase.rpc('engine_health')
    setLoading(false)
    if (error) return setErr(error.message)
    if (res?.error) return setErr(res.error === 'forbidden' ? 'Solo la Junta Directiva puede ver la salud del motor.' : String(res.error))
    setData(res)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  if (!isJunta) {
    return (
      <div className="h-full grid place-items-center text-nina-mute text-sm text-center px-6">
        Solo la Junta Directiva puede ver la salud del motor.
      </div>
    )
  }

  const agents = data?.agents ?? []
  const tasks = data?.tasks ?? {}
  const fmt = (n) => Number(n ?? 0).toLocaleString()

  return (
    <div className="h-full overflow-y-auto px-4 sm:px-6 py-5">
      <div className="max-w-5xl mx-auto w-full space-y-6">
        {/* Header */}
        <header className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg grid place-items-center bg-silver-gradient text-nina-black">
              <Activity className="w-4 h-4" />
            </span>
            <div>
              <h1 className="text-base font-display tracking-wide text-nina-chrome">Salud del Motor</h1>
              <p className="text-[11px] text-nina-mute">
                {data?.generated_at ? `Actualizado ${new Date(data.generated_at).toLocaleTimeString()}` : 'Observabilidad de agentes'}
              </p>
            </div>
          </div>
          <button onClick={load} disabled={loading} className="btn-ghost !py-1.5 !px-3 text-xs flex items-center gap-1.5">
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Actualizar
          </button>
        </header>

        {err && (
          <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[12px] text-amber-200">{err}</div>
        )}

        {loading && !data ? (
          <div className="grid place-items-center py-16 text-nina-mute"><Loader2 className="w-5 h-5 animate-spin" /></div>
        ) : data ? (
          <>
            {/* Resumen */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <StatCard icon={CheckCircle2} label="Aprobaciones pendientes" value={fmt(data.pending_approvals)} accent={Number(data.pending_approvals) > 0 ? 'amber' : 'mute'} />
              <StatCard icon={Wrench} label="Tool calls hoy" value={fmt(data.tool_calls_today)} accent="mute" />
              <StatCard icon={AlertTriangle} label="Fallos de tools hoy" value={fmt(data.tool_failures_today)} accent={Number(data.tool_failures_today) > 0 ? 'red' : 'mute'} />
            </div>

            {/* Agentes — tokens del día + estado */}
            <section className="space-y-2">
              <h2 className="text-[10px] uppercase tracking-[0.2em] text-nina-mute flex items-center gap-1.5"><Coins className="w-3.5 h-3.5" /> Tokens consumidos hoy (por agente)</h2>
              <div className="rounded-xl border border-nina-line bg-nina-panel/40 divide-y divide-nina-line/60">
                {agents.length === 0 ? (
                  <div className="px-4 py-3 text-[12px] text-nina-mute">Sin agentes.</div>
                ) : agents.map((a) => (
                  <div key={a.slug} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[a.status] ?? 'bg-nina-mute'}`} />
                      <span className="text-[13px] text-nina-chrome truncate">{a.name}</span>
                      <span className="text-[10px] text-nina-mute uppercase tracking-wide hidden sm:inline">{a.role}</span>
                    </div>
                    <span className="text-[12px] font-mono text-nina-chrome shrink-0">{fmt(a.tokens_today)} <span className="text-nina-mute">tok</span></span>
                  </div>
                ))}
              </div>
            </section>

            {/* Tareas por estado */}
            <section className="space-y-2">
              <h2 className="text-[10px] uppercase tracking-[0.2em] text-nina-mute">Tareas por estado</h2>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                {TASK_ORDER.map((k) => (
                  <div key={k} className="rounded-lg border border-nina-line bg-nina-panel/40 px-2 py-2 text-center">
                    <div className="text-lg font-display text-nina-chrome">{fmt(tasks[k])}</div>
                    <div className="text-[10px] text-nina-mute leading-tight">{TASK_LABELS[k]}</div>
                  </div>
                ))}
              </div>
            </section>
          </>
        ) : null}
      </div>
    </div>
  )
}

function StatCard({ icon: Icon, label, value, accent }) {
  const accents = {
    amber: 'text-amber-300',
    red: 'text-red-300',
    mute: 'text-nina-chrome',
  }
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-nina-line bg-nina-panel/40 px-4 py-3"
    >
      <div className="flex items-center gap-1.5 text-[11px] text-nina-mute mb-1">
        <Icon className="w-3.5 h-3.5" /> {label}
      </div>
      <div className={`text-2xl font-display ${accents[accent] ?? 'text-nina-chrome'}`}>{value}</div>
    </motion.div>
  )
}
