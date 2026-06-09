import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { withAuthRetry } from '../lib/supabaseQuery'

const FETCH_TIMEOUT = 15000

// Lista conversaciones (todas o de un agente), ordenadas por actividad
// reciente, con realtime. Incluye nombre/slug del agente para poder
// renderizar el historial en el sidebar global (estilo Manus).
export function useConversations({ agentId = null, limit = 50 } = {}) {
  const [conversations, setConversations] = useState([])
  const [loading, setLoading] = useState(true)
  const channelIdRef = useRef(`${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)

  useEffect(() => {
    let active = true
    setLoading(true)

    const load = async () => {
      try {
        const result = await Promise.race([
          withAuthRetry(() => {
            let q = supabase
              .from('conversations')
              .select(
                'id, title, agent_id, project_id, message_count, last_message_at, created_at, is_favorite, is_archived, agents(name, slug, role)',
              )
              .order('last_message_at', { ascending: false })
              .limit(limit)
            if (agentId) q = q.eq('agent_id', agentId)
            return q
          }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Timeout cargando conversaciones')), FETCH_TIMEOUT),
          ),
        ])
        if (!active) return
        if (result.error) {
          console.error('[CRM-AI] conversations fetch error:', result.error)
          setConversations([])
        } else {
          setConversations(result.data ?? [])
        }
      } catch (e) {
        console.error('[CRM-AI] conversations load failed:', e)
        if (active) setConversations([])
      } finally {
        if (active) setLoading(false)
      }
    }
    load()

    // Realtime: cualquier cambio en conversations recarga la lista (el trigger
    // de mensajes actualiza last_message_at, así que el orden se mantiene vivo).
    const channel = supabase
      .channel(`conversations-${agentId ?? 'all'}-${channelIdRef.current}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, load)
      .subscribe()

    return () => {
      active = false
      try {
        supabase.removeChannel(channel)
      } catch {}
    }
  }, [agentId, limit])

  return { conversations, loading }
}
