import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { withAuthRetry } from '../lib/supabaseQuery'

const FETCH_TIMEOUT = 15000

// Lista los proyectos (carpetas) con realtime. Un proyecto agrupa
// conversaciones (conversations.project_id).
export function useProjects() {
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const channelIdRef = useRef(`${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)

  useEffect(() => {
    let active = true
    setLoading(true)

    const load = async () => {
      try {
        const result = await Promise.race([
          withAuthRetry(() =>
            supabase
              .from('projects')
              .select('id, name, color, created_at')
              .order('created_at', { ascending: true }),
          ),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Timeout cargando proyectos')), FETCH_TIMEOUT),
          ),
        ])
        if (!active) return
        if (result.error) {
          console.error('[CRM-AI] projects fetch error:', result.error)
          setProjects([])
        } else {
          setProjects(result.data ?? [])
        }
      } catch (e) {
        console.error('[CRM-AI] projects load failed:', e)
        if (active) setProjects([])
      } finally {
        if (active) setLoading(false)
      }
    }
    load()

    const channel = supabase
      .channel(`projects-${channelIdRef.current}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'projects' }, load)
      .subscribe()

    return () => {
      active = false
      try {
        supabase.removeChannel(channel)
      } catch {}
    }
  }, [])

  return { projects, loading }
}
