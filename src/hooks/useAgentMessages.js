import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { withAuthRetry } from '../lib/supabaseQuery'

const FETCH_TIMEOUT = 8000

// Devuelve los últimos N mensajes de un agente, ordenados ascendente,
// y se suscribe a inserts en realtime para que el chat se actualice solo.
export function useAgentMessages(agentId, limit = 100) {
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(Boolean(agentId))
  const channelIdRef = useRef(
    `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  )

  useEffect(() => {
    if (!agentId) {
      setMessages([])
      setLoading(false)
      return
    }
    let active = true
    setLoading(true)

    const load = async () => {
      try {
        const result = await Promise.race([
          withAuthRetry(() =>
            supabase
              .from('messages')
              .select(
                'id, role, content, tool_call_id, tool_calls, task_id, metadata, created_at',
              )
              .eq('agent_id', agentId)
              .order('created_at', { ascending: false })
              .limit(limit),
          ),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Timeout cargando mensajes')), FETCH_TIMEOUT),
          ),
        ])
        if (!active) return
        if (result.error) {
          console.error('[CRM-AI] messages fetch error:', result.error)
          setMessages([])
        } else {
          setMessages((result.data ?? []).slice().reverse())
        }
      } catch (e) {
        console.error('[CRM-AI] messages load failed:', e)
        if (active) setMessages([])
      } finally {
        if (active) setLoading(false)
      }
    }
    load()

    const channel = supabase
      .channel(`messages-${agentId}-${channelIdRef.current}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `agent_id=eq.${agentId}` },
        (payload) => {
          if (!active) return
          setMessages((prev) => {
            if (prev.some((m) => m.id === payload.new.id)) return prev
            return [...prev, payload.new].slice(-limit)
          })
        },
      )
      .subscribe()

    return () => {
      active = false
      try {
        supabase.removeChannel(channel)
      } catch {}
    }
  }, [agentId, limit])

  return { messages, loading }
}
