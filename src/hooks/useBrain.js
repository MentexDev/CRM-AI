import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

// Cliente del cerebro de negocio (RAG). La UI NO habla con las funciones del
// cerebro directamente: pasa por la Edge Function `brain-proxy` (autenticada con
// el login), que verifica al usuario y reenvía con la key del motor / lee las
// tablas con service_role. Así la key nunca llega al navegador.
//
// Acciones: list_documents · ingest · query · health.
export function useBrain(brandId) {
  const [documents, setDocuments] = useState([])
  const [loadingDocs, setLoadingDocs] = useState(false)
  const [health, setHealth] = useState(null)
  const [loadingHealth, setLoadingHealth] = useState(false)
  const [results, setResults] = useState(null) // { chunks, entities, stats }
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState(null)

  const activeRef = useRef(true)
  useEffect(() => {
    activeRef.current = true
    return () => {
      activeRef.current = false
    }
  }, [])

  // Llamada base al proxy. Lanza si hay error de red o de la función.
  const call = useCallback(async (action, extra = {}) => {
    if (!supabase) throw new Error('Supabase no está configurado')
    const { data, error } = await supabase.functions.invoke('brain-proxy', {
      body: { action, brand_id: brandId, ...extra },
    })
    if (error) throw error
    if (data?.error) throw new Error(data.error)
    return data
  }, [brandId])

  const loadDocuments = useCallback(async () => {
    if (!brandId) {
      setDocuments([])
      return
    }
    setLoadingDocs(true)
    try {
      const data = await call('list_documents')
      if (activeRef.current) setDocuments(data?.documents ?? [])
    } catch (e) {
      console.error('[CRM-AI] brain list_documents failed:', e)
      if (activeRef.current) setDocuments([])
    } finally {
      if (activeRef.current) setLoadingDocs(false)
    }
  }, [brandId, call])

  const loadHealth = useCallback(async () => {
    if (!brandId) {
      setHealth(null)
      return
    }
    setLoadingHealth(true)
    try {
      const data = await call('health')
      if (activeRef.current) setHealth(data ?? null)
    } catch (e) {
      console.error('[CRM-AI] brain health failed:', e)
      if (activeRef.current) setHealth(null)
    } finally {
      if (activeRef.current) setLoadingHealth(false)
    }
  }, [brandId, call])

  // Carga inicial / al cambiar de marca.
  useEffect(() => {
    loadDocuments()
    loadHealth()
    setResults(null)
    setSearchError(null)
  }, [loadDocuments, loadHealth])

  // Ingesta un documento. Devuelve el resultado ({ document_id, chunks_created… })
  // y refresca documentos + salud. Lanza en error (lo maneja el modal).
  const ingest = useCallback(
    async ({ title, content, sourceUrl, sourceKind = 'manual' }) => {
      const data = await call('ingest', {
        title,
        content: content || undefined,
        source_url: sourceUrl || undefined,
        source_kind: sourceKind,
      })
      loadDocuments()
      loadHealth()
      return data
    },
    [call, loadDocuments, loadHealth],
  )

  // Búsqueda semántica. Setea results; tolera error mostrándolo.
  const search = useCallback(
    async (query) => {
      const q = (query || '').trim()
      if (q.length < 3) {
        setSearchError('Escribe al menos 3 caracteres.')
        return
      }
      setSearching(true)
      setSearchError(null)
      try {
        const data = await call('query', { query: q })
        if (activeRef.current) {
          setResults({
            chunks: data?.chunks ?? [],
            entities: data?.entities ?? [],
            stats: data?.stats ?? null,
          })
        }
      } catch (e) {
        if (activeRef.current) {
          setSearchError(e?.message || 'No se pudo buscar en el cerebro.')
          setResults(null)
        }
      } finally {
        if (activeRef.current) setSearching(false)
      }
    },
    [call],
  )

  const clearSearch = useCallback(() => {
    setResults(null)
    setSearchError(null)
  }, [])

  const refresh = useCallback(() => {
    loadDocuments()
    loadHealth()
  }, [loadDocuments, loadHealth])

  return {
    documents,
    loadingDocs,
    health,
    loadingHealth,
    results,
    searching,
    searchError,
    ingest,
    search,
    clearSearch,
    refresh,
  }
}
