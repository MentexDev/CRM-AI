import { useEffect, useId, useState } from 'react'
import { supabase } from '../lib/supabase'

// Tareas de un agente — todas (kanban). Realtime para refrescar en cambios.
export function useAgentTasks(agentId) {
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(Boolean(agentId))
  const channelId = useId()

  useEffect(() => {
    if (!agentId) {
      setTasks([])
      setLoading(false)
      return
    }
    let active = true
    setLoading(true)

    const load = async () => {
      const { data, error } = await supabase
        .from('tasks')
        .select('id, title, status, priority, due_at, parent_task_id, created_at, updated_at, result')
        .eq('agent_id', agentId)
        .order('priority', { ascending: true })
        .order('created_at', { ascending: false })
      if (!active) return
      if (error) console.error('[CRM-AI] tasks fetch error:', error)
      setTasks(data ?? [])
      setLoading(false)
    }
    load()

    const channel = supabase
      .channel(`tasks-${agentId}-${channelId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tasks', filter: `agent_id=eq.${agentId}` },
        load,
      )
      .subscribe()

    return () => {
      active = false
      supabase.removeChannel(channel)
    }
  }, [agentId, channelId])

  return { tasks, loading }
}
