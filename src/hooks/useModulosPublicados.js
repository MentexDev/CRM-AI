import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

// Módulos publicados: plantillas del agente Code (document/sheet/board/slides) publicadas como secciones
// navegables a pantalla completa, listadas en el switcher horizontal del sidebar. Se actualiza en tiempo
// real. removeModule borra un módulo (RLS permite a usuarios autenticados).
export function useModulosPublicados() {
  const [modules, setModules] = useState([])
  const [loading, setLoading] = useState(true)
  const chanRef = useRef(`published_modules-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)

  useEffect(() => {
    let active = true
    const load = async () => {
      const { data, error } = await supabase
        .from('published_modules')
        .select('id, title, kind, data, sections, source_conversation_id, source_artifact_key, agent_id, created_at')
        .order('created_at', { ascending: false })
      if (!active) return
      if (error) console.error('[CRM-AI] published_modules fetch:', error)
      setModules(data ?? [])
      setLoading(false)
    }
    load()
    const ch = supabase
      .channel(chanRef.current)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'published_modules' }, load)
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

  const removeModule = async (id) => {
    const { error } = await supabase.from('published_modules').delete().eq('id', id)
    if (error) {
      console.error('[CRM-AI] published_modules delete:', error)
      throw error
    }
  }

  const renameModule = async (id, title) => {
    const t = String(title || '').trim()
    if (!t) return
    const { error } = await supabase.from('published_modules').update({ title: t }).eq('id', id)
    if (error) {
      console.error('[CRM-AI] published_modules rename:', error)
      throw error
    }
  }

  return { modules, loading, removeModule, renameModule }
}
