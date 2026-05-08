import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { withAuthRetry } from '../lib/supabaseQuery'

const FETCH_TIMEOUT = 8000

export function useBrands() {
  const [brands, setBrands] = useState([])
  const [loading, setLoading] = useState(true)
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
            supabase.from('brands').select('id, slug, name, status').order('name', { ascending: true }),
          ),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Timeout cargando marcas')), FETCH_TIMEOUT),
          ),
        ])
        if (!active) return
        if (result.error) console.error('[CRM-AI] brands fetch error:', result.error)
        setBrands(result.data ?? [])
      } catch (e) {
        console.error('[CRM-AI] brands load failed:', e)
        if (active) setBrands([])
      } finally {
        if (active) setLoading(false)
      }
    }
    load()

    const channel = supabase
      .channel(`brands-${channelIdRef.current}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'brands' }, load)
      .subscribe()

    return () => {
      active = false
      try {
        supabase.removeChannel(channel)
      } catch {}
    }
  }, [])

  return { brands, loading }
}
