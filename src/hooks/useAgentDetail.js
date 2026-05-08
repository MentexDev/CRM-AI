import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

const FETCH_TIMEOUT = 8000

// Devuelve el agente completo (incluyendo system_prompt, allowed_tools, config).
// useAgents() lista sólo campos básicos para la sidebar; este hook se usa en
// las pestañas internas que necesitan el detalle.
export function useAgentDetail(agentId) {
  const [agent, setAgent] = useState(null)
  const [loading, setLoading] = useState(Boolean(agentId))
  const channelIdRef = useRef(
    `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  )

  useEffect(() => {
    if (!agentId) {
      setAgent(null)
      setLoading(false)
      return
    }
    let active = true
    setLoading(true)

    const load = async () => {
      try {
        const result = await Promise.race([
          supabase.from('agents').select('*').eq('id', agentId).maybeSingle(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Timeout cargando agente')), FETCH_TIMEOUT),
          ),
        ])
        if (!active) return
        if (result.error) console.error('[CRM-AI] agent detail error:', result.error)
        setAgent(result.data ?? null)
      } catch (e) {
        console.error('[CRM-AI] agent detail load failed:', e)
        if (active) setAgent(null)
      } finally {
        if (active) setLoading(false)
      }
    }
    load()

    const channel = supabase
      .channel(`agent-detail-${agentId}-${channelIdRef.current}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'agents', filter: `id=eq.${agentId}` },
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

  return { agent, loading }
}
