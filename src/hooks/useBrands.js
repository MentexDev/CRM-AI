import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export function useBrands() {
  const [brands, setBrands] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    const load = async () => {
      const { data, error } = await supabase
        .from('brands')
        .select('id, slug, name, status')
        .order('name', { ascending: true })
      if (!active) return
      if (error) console.error('[CRM-AI] brands fetch error:', error)
      setBrands(data ?? [])
      setLoading(false)
    }
    load()

    const channel = supabase
      .channel('brands-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'brands' }, load)
      .subscribe()

    return () => {
      active = false
      supabase.removeChannel(channel)
    }
  }, [])

  return { brands, loading }
}
