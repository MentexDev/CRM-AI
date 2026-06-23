import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { withAuthRetry } from '../lib/supabaseQuery'

const FETCH_TIMEOUT = 15000

// Lista los agentes visibles para el usuario actual (RLS filtra por marca).
// Se actualiza en tiempo real con cualquier cambio en la tabla agents.
export function useAgents() {
  const [agents, setAgents] = useState([])
  const [loading, setLoading] = useState(true)
  // ID único por montaje (no determinista como useId, evita colisiones cuando
  // el componente se desmonta y vuelve a montar antes de que el cleanup del
  // canal anterior haya terminado).
  const channelIdRef = useRef(
    `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  )

  useEffect(() => {
    let active = true
    setLoading(true)

    const load = async () => {
      try {
        const result = await Promise.race([
          withAuthRetry(() =>
            supabase
              .from('agents')
              .select(
                'id, slug, name, role, specialty, brand_id, parent_agent_id, status, model, last_heartbeat_at, pinned, sort_order',
              )
              .order('role', { ascending: true })
              .order('name', { ascending: true }),
          ),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Timeout cargando agentes')), FETCH_TIMEOUT),
          ),
        ])
        if (!active) return
        if (result.error) console.error('[CRM-AI] agents fetch error:', result.error)
        setAgents(result.data ?? [])
      } catch (e) {
        console.error('[CRM-AI] agents load failed:', e)
        if (active) setAgents([])
      } finally {
        if (active) setLoading(false)
      }
    }
    load()

    const channel = supabase
      .channel(`agents-${channelIdRef.current}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agents' }, load)
      .subscribe()

    return () => {
      active = false
      try {
        supabase.removeChannel(channel)
      } catch {}
    }
  }, [])

  return { agents, loading }
}
