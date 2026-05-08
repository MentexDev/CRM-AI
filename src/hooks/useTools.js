import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export function useTools() {
  const [tools, setTools] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    const load = async () => {
      const { data, error } = await supabase
        .from('tools_registry')
        .select('name, description, category, requires_approval, is_active')
        .eq('is_active', true)
        .order('category')
        .order('name')
      if (!active) return
      if (error) console.error('[CRM-AI] tools fetch error:', error)
      setTools(data ?? [])
      setLoading(false)
    }
    load()
    return () => {
      active = false
    }
  }, [])

  return { tools, loading }
}
