import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

// Plantillas de trabajo creadas por el agente Code (galería "Plantillas Code"). RLS filtra por marca
// (global = brand_id null, visible para todos). Se actualiza en tiempo real.
export function useCodeTemplates() {
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)
  const chanRef = useRef(`code_templates-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)

  useEffect(() => {
    let active = true
    const load = async () => {
      const { data, error } = await supabase
        .from('code_templates')
        .select('id, title, kind, data, cover_url, description, category, brand_id, agent_id, source_conversation_id, source_artifact_key, created_at')
        .order('created_at', { ascending: false })
      if (!active) return
      if (error) console.error('[CRM-AI] code_templates fetch:', error)
      setTemplates(data ?? [])
      setLoading(false)
    }
    load()
    const ch = supabase
      .channel(chanRef.current)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'code_templates' }, load)
      .subscribe()
    return () => {
      active = false
      try {
        supabase.removeChannel(ch)
      } catch {
        /* */
      }
    }
  }, [])

  return { templates, loading }
}
