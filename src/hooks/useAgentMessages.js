import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Devuelve los últimos N mensajes de un agente, ordenados ascendente,
// y se suscribe a inserts en realtime para que el chat se actualice solo.
export function useAgentMessages(agentId, limit = 100) {
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(Boolean(agentId))

  useEffect(() => {
    if (!agentId) {
      setMessages([])
      setLoading(false)
      return
    }
    let active = true
    setLoading(true)

    const load = async () => {
      const { data, error } = await supabase
        .from('messages')
        .select('id, role, content, tool_call_id, tool_calls, task_id, metadata, created_at')
        .eq('agent_id', agentId)
        .order('created_at', { ascending: false })
        .limit(limit)
      if (!active) return
      if (error) {
        console.error('[CRM-AI] messages fetch error:', error)
        setMessages([])
      } else {
        setMessages((data ?? []).slice().reverse())
      }
      setLoading(false)
    }
    load()

    const channel = supabase
      .channel(`messages-agent-${agentId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `agent_id=eq.${agentId}` },
        (payload) => {
          if (!active) return
          setMessages((prev) => {
            // Evita duplicados si el realtime entrega antes que la query inicial
            if (prev.some((m) => m.id === payload.new.id)) return prev
            return [...prev, payload.new].slice(-limit)
          })
        },
      )
      .subscribe()

    return () => {
      active = false
      supabase.removeChannel(channel)
    }
  }, [agentId, limit])

  return { messages, loading }
}
