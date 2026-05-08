import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Lista los agentes visibles para el usuario actual (RLS filtra por marca).
// Se actualiza en tiempo real con cualquier cambio en la tabla agents.
export function useAgents() {
  const [agents, setAgents] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    const load = async () => {
      const { data, error } = await supabase
        .from('agents')
        .select('id, slug, name, role, specialty, brand_id, parent_agent_id, status, model, last_heartbeat_at')
        .order('role', { ascending: true })
        .order('name', { ascending: true })
      if (!active) return
      if (error) console.error('[CRM-AI] agents fetch error:', error)
      setAgents(data ?? [])
      setLoading(false)
    }
    load()

    const channel = supabase
      .channel('agents-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agents' }, load)
      .subscribe()

    return () => {
      active = false
      supabase.removeChannel(channel)
    }
  }, [])

  return { agents, loading }
}
