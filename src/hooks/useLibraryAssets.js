import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { withAuthRetry } from '../lib/supabaseQuery'

const FETCH_TIMEOUT = 15000

// Entregables de los agentes (campañas + tareas hechas), de library_assets.
export function useLibraryAssets() {
  const [assets, setAssets] = useState([])
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
              .from('library_assets')
              .select(
                'id, title, kind, content, url, source, source_run_id, source_task_id, brand_id, agent_id, size_bytes, created_at',
              )
              .order('created_at', { ascending: false })
              .limit(500),
          ),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Timeout cargando biblioteca')), FETCH_TIMEOUT),
          ),
        ])
        if (!active) return
        if (result.error) console.error('[CRM-AI] library fetch error:', result.error)
        setAssets(result.data ?? [])
      } catch (e) {
        console.error('[CRM-AI] library load failed:', e)
        if (active) setAssets([])
      } finally {
        if (active) setLoading(false)
      }
    }
    load()

    const channel = supabase
      .channel(`library-${channelIdRef.current}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'library_assets' }, load)
      .subscribe()

    return () => {
      active = false
      try {
        supabase.removeChannel(channel)
      } catch {}
    }
  }, [])

  return { assets, loading }
}
