import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { withAuthRetry } from '../lib/supabaseQuery'

const FETCH_TIMEOUT = 15000

// Devuelve los mensajes de UNA conversación, ordenados ascendente, y se
// suscribe a inserts en realtime para que el chat se actualice solo.
//
// Si `conversationId` es null/undefined, no hay conversación activa todavía
// (estado "nueva conversación"): devolvemos lista vacía y no consultamos.
export function useAgentMessages(agentId, conversationId, limit = 200) {
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(Boolean(agentId && conversationId))
  const channelIdRef = useRef(
    `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  )

  useEffect(() => {
    if (!agentId || !conversationId) {
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
                'id, role, content, tool_call_id, tool_calls, conversation_id, metadata, created_at',
              )
              .eq('conversation_id', conversationId)
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
      .channel(`messages-${conversationId}-${channelIdRef.current}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          if (!active) return
          // UPDATE: el mensaje se llena token a token (streaming en vivo)
          if (payload.eventType === 'UPDATE') {
            setMessages((prev) =>
              prev.map((m) => (m.id === payload.new.id ? payload.new : m)),
            )
            return
          }
          // INSERT: mensaje nuevo
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
  }, [agentId, conversationId, limit])

  return { messages, loading }
}
