import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Loader2, ListTodo } from 'lucide-react'
import EmptyState from '../../components/EmptyState'
import { supabase } from '../../lib/supabase'

const COLUMNS = [
  { key: 'to_do', label: 'Por hacer' },
  { key: 'in_progress', label: 'En progreso' },
  { key: 'blocked', label: 'Bloqueadas' },
  { key: 'needs_review', label: 'Para revisar' },
  { key: 'done', label: 'Hechas' },
]

const PRIORITY_LABEL = ['', 'Crítica', 'Alta', 'Normal', 'Baja', 'Eventual']
const PRIORITY_COLOR = [
  '',
  'text-red-300 bg-red-500/10 border-red-500/20',
  'text-amber-300 bg-amber-500/10 border-amber-500/20',
  'text-nina-chrome bg-nina-line/40 border-nina-line',
  'text-nina-mute bg-nina-line/20 border-nina-line/50',
  'text-nina-mute bg-nina-line/10 border-nina-line/30',
]

export default function Tasks() {
  const [tasks, setTasks] = useState([])
  const [agentsById, setAgentsById] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    const load = async () => {
      const [{ data: t, error: te }, { data: a }] = await Promise.all([
        supabase
          .from('tasks')
          .select('id, title, status, priority, agent_id, brand_id, due_at, created_at')
          .order('priority', { ascending: true })
          .order('created_at', { ascending: false })
          .limit(500),
        supabase.from('agents').select('id, name, slug'),
      ])
      if (!active) return
      if (te) console.error('[CRM-AI] tasks error:', te)
      setTasks(t ?? [])
      const map = {}
      for (const ag of a ?? []) map[ag.id] = ag
      setAgentsById(map)
      setLoading(false)
    }
    load()

    const channel = supabase
      .channel('tasks-all')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, load)
      .subscribe()

    return () => {
      active = false
      supabase.removeChannel(channel)
    }
  }, [])

  const grouped = useMemo(() => {
    const out = Object.fromEntries(COLUMNS.map((c) => [c.key, []]))
    for (const t of tasks) {
      if (out[t.status]) out[t.status].push(t)
    }
    return out
  }, [tasks])

  if (loading) {
    return (
      <div className="grid place-items-center py-20 text-nina-mute">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    )
  }

  if (tasks.length === 0) {
    return (
      <EmptyState
        icon={ListTodo}
        title="Aún no hay tareas"
        description="Crea tareas desde la pestaña de Agentes para que el sistema arranque a trabajar."
      />
    )
  }

  return (
    <div className="space-y-6">
      <header>
        <h2 className="font-display text-2xl silver-text mb-1">Tablero de tareas</h2>
        <p className="text-sm text-nina-mute">
          Vista global del trabajo. Cada agente prioriza la suya por orden de prioridad y antigüedad.
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
        {COLUMNS.map((c) => (
          <div key={c.key} className="panel p-3 min-h-[120px]">
            <div className="flex items-center justify-between px-1 mb-3">
              <h3 className="text-xs uppercase tracking-[0.2em] text-nina-mute">{c.label}</h3>
              <span className="text-[10px] text-nina-mute">{grouped[c.key].length}</span>
            </div>
            <div className="space-y-2">
              {grouped[c.key].map((t) => (
                <motion.div
                  key={t.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-lg border border-nina-line bg-nina-ink p-3 space-y-2"
                >
                  <div className="text-sm text-nina-chrome leading-snug">{t.title}</div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`chip ${PRIORITY_COLOR[t.priority] ?? PRIORITY_COLOR[3]} text-[10px]`}
                    >
                      {PRIORITY_LABEL[t.priority] ?? 'Normal'}
                    </span>
                    {t.agent_id && agentsById[t.agent_id] && (
                      <span className="text-[10px] text-nina-mute">
                        → {agentsById[t.agent_id].name}
                      </span>
                    )}
                  </div>
                </motion.div>
              ))}
              {grouped[c.key].length === 0 && (
                <div className="text-[11px] text-nina-mute px-1 py-3 text-center">—</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
