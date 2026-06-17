import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { withAuthRetry } from '../lib/supabaseQuery'

const FETCH_TIMEOUT = 15000

// Mensajes ligados a UNA tarea (task_id), ordenados ascendente, con suscripción
// realtime para que el timeline de actividad del drawer se actualice en vivo
// mientras el agente trabaja. Los tokens viven en metadata.usage.total_tokens y
// los tool_calls van embebidos en la columna jsonb `tool_calls` + mensajes role='tool'.
export function useTaskActivity(taskId) {
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(Boolean(taskId))
  const channelIdRef = useRef(`${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)

  useEffect(() => {
    if (!taskId) {
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
              .select('id, role, content, tool_calls, metadata, created_at')
              .eq('task_id', taskId)
              .order('created_at', { ascending: true })
              .limit(300),
          ),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Timeout cargando actividad')), FETCH_TIMEOUT),
          ),
        ])
        if (!active) return
        setMessages(result.error ? [] : result.data ?? [])
      } catch (e) {
        console.error('[CRM-AI] task activity load failed:', e)
        if (active) setMessages([])
      } finally {
        if (active) setLoading(false)
      }
    }
    load()

    const channel = supabase
      .channel(`task-activity-${taskId}-${channelIdRef.current}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'messages', filter: `task_id=eq.${taskId}` },
        (payload) => {
          if (!active) return
          if (payload.eventType === 'UPDATE') {
            setMessages((prev) => prev.map((m) => (m.id === payload.new.id ? payload.new : m)))
          } else if (payload.eventType === 'INSERT') {
            setMessages((prev) =>
              prev.some((m) => m.id === payload.new.id) ? prev : [...prev, payload.new],
            )
          }
        },
      )
      .subscribe()

    return () => {
      active = false
      try {
        supabase.removeChannel(channel)
      } catch {}
    }
  }, [taskId])

  return { messages, loading }
}
