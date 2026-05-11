import { useEffect, useId, useState } from 'react'
import { motion } from 'framer-motion'
import { Check, CheckCircle2, Loader2, X } from 'lucide-react'
import toast from 'react-hot-toast'
import EmptyState from '../../components/EmptyState'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

const TRIGGER_LABEL = {
  expense: 'Gasto / presupuesto',
  public_publish: 'Publicación pública',
  external_comm: 'Comunicación externa',
  structural: 'Cambio estructural',
  inventory_threshold: 'Movimiento de inventario',
  agent_uncertain: 'Agente con duda',
}

export default function Approvals() {
  const { user, isJunta } = useAuth()
  const [items, setItems] = useState([])
  const [agentsById, setAgentsById] = useState({})
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)
  const channelId = useId()

  useEffect(() => {
    let active = true
    const load = async () => {
      const [{ data, error }, { data: a }] = await Promise.all([
        supabase
          .from('approvals')
          .select('*')
          .eq('status', 'pending')
          .order('created_at', { ascending: false }),
        supabase.from('agents').select('id, name, slug'),
      ])
      if (!active) return
      if (error) console.error('[CRM-AI] approvals error:', error)
      setItems(data ?? [])
      const map = {}
      for (const ag of a ?? []) map[ag.id] = ag
      setAgentsById(map)
      setLoading(false)
    }
    load()

    const channel = supabase
      .channel(`approvals-all-${channelId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'approvals' }, load)
      .subscribe()

    return () => {
      active = false
      supabase.removeChannel(channel)
    }
  }, [channelId])

  const decide = async (item, decision) => {
    if (!isJunta) {
      toast.error('Sólo la Junta Directiva puede decidir aprobaciones')
      return
    }
    setBusyId(item.id)
    const t = toast.loading(decision === 'approved' ? 'Aprobando…' : 'Rechazando…')
    try {
      const { error } = await supabase
        .from('approvals')
        .update({
          status: decision,
          decided_by: user?.id,
          decided_at: new Date().toISOString(),
        })
        .eq('id', item.id)
      if (error) throw error

      // Si se aprobó Y el payload tiene un tool_name (operación pendiente
      // de ejecutar), invocamos execute-approval para que el runtime haga
      // la operación real y le notifique al agente.
      const payload = item.payload || {}
      if (decision === 'approved' && payload.tool_name) {
        toast.loading(`Ejecutando ${payload.tool_name}…`, { id: t })
        const { data: execData, error: execErr } = await supabase.functions.invoke(
          'execute-approval',
          { body: { approval_id: item.id } },
        )
        if (execErr) throw execErr
        if (execData?.error) throw new Error(execData.error)
        if (execData?.executed === false) {
          toast.error(`Aprobado, pero la ejecución falló: ${execData?.result?.error || 'desconocido'}`, { id: t })
        } else {
          toast.success(`Aprobado y ejecutado · ${payload.tool_name}`, { id: t })
        }
      } else {
        toast.success(decision === 'approved' ? 'Aprobado' : 'Rechazado', { id: t })
      }
    } catch (err) {
      toast.error(err.message || 'No se pudo guardar la decisión', { id: t })
    } finally {
      setBusyId(null)
    }
  }

  if (loading) {
    return (
      <div className="grid place-items-center py-20 text-nina-mute">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={CheckCircle2}
        title="No hay aprobaciones pendientes"
        description="Cuando un agente solicite tu OK para una decisión crítica, aparecerá aquí."
      />
    )
  }

  return (
    <div className="space-y-5">
      <header>
        <h2 className="font-display text-2xl silver-text mb-1">Aprobaciones pendientes</h2>
        <p className="text-sm text-nina-mute">
          Decisiones que los agentes te delegaron. Sólo la Junta Directiva puede resolverlas.
        </p>
      </header>

      <div className="space-y-3">
        {items.map((item) => {
          const agent = agentsById[item.agent_id]
          return (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="panel p-4 sm:p-5 space-y-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="text-[10px] uppercase tracking-[0.2em] text-nina-mute">
                    {TRIGGER_LABEL[item.trigger] ?? item.trigger}
                  </div>
                  <div className="text-sm text-nina-chrome leading-snug">{item.summary}</div>
                  {agent && (
                    <div className="text-[11px] text-nina-mute">Solicitado por {agent.name}</div>
                  )}
                </div>
              </div>

              {item.payload && Object.keys(item.payload).length > 0 && (
                <details className="rounded-lg border border-nina-line bg-nina-ink/60 group">
                  <summary className="cursor-pointer px-3 py-2 text-[11px] uppercase tracking-[0.18em] text-nina-mute select-none">
                    Detalles
                  </summary>
                  <pre className="px-3 pb-3 text-[11px] font-mono text-nina-chrome whitespace-pre-wrap break-words">
                    {JSON.stringify(item.payload, null, 2)}
                  </pre>
                </details>
              )}

              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  onClick={() => decide(item, 'approved')}
                  disabled={busyId === item.id || !isJunta}
                  className="btn-primary !py-2 !px-3 text-xs flex items-center gap-1.5"
                >
                  <Check className="w-3.5 h-3.5" />
                  Aprobar
                </button>
                <button
                  onClick={() => decide(item, 'rejected')}
                  disabled={busyId === item.id || !isJunta}
                  className="btn-danger !py-2 !px-3 text-xs flex items-center gap-1.5"
                >
                  <X className="w-3.5 h-3.5" />
                  Rechazar
                </button>
                {!isJunta && (
                  <span className="text-[11px] text-nina-mute self-center ml-1">
                    (sólo Junta Directiva)
                  </span>
                )}
              </div>
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}
