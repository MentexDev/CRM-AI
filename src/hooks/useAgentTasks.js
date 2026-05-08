import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

const FETCH_TIMEOUT = 8000

// Tareas de un agente — todas (kanban). Realtime para refrescar en cambios.
export function useAgentTasks(agentId) {
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(Boolean(agentId))
  const channelIdRef = useRef(
    `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  )

  useEffect(() => {
    if (!agentId) {
      setTasks([])
      setLoading(false)
      return
    }
    let active = true
    setLoading(true)

    const load = async () => {
      try {
        const result = await Promise.race([
          supabase
            .from('tasks')
            .select(
              'id, title, status, priority, due_at, parent_task_id, created_at, updated_at, result',
            )
            .eq('agent_id', agentId)
            .order('priority', { ascending: true })
            .order('created_at', { ascending: false }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Timeout cargando tareas')), FETCH_TIMEOUT),
          ),
        ])
        if (!active) return
        if (result.error) console.error('[CRM-AI] tasks fetch error:', result.error)
        setTasks(result.data ?? [])
      } catch (e) {
        console.error('[CRM-AI] tasks load failed:', e)
        if (active) setTasks([])
      } finally {
        if (active) setLoading(false)
      }
    }
    load()

    const channel = supabase
      .channel(`tasks-${agentId}-${channelIdRef.current}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tasks', filter: `agent_id=eq.${agentId}` },
        load,
      )
      .subscribe()

    return () => {
      active = false
      try {
        supabase.removeChannel(channel)
      } catch {}
    }
  }, [agentId])

  return { tasks, loading }
}
