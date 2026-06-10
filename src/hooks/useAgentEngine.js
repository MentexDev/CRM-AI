import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

// Cliente del motor agéntico. La UI NO habla con el motor directamente: pasa por
// la Edge Function `run-engine` (autenticada con el login), que guarda la key del
// motor server-side. Así la key nunca llega al navegador.
export function useAgentEngine() {
  const [status, setStatus] = useState('idle') // idle | running | done | error
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [runId, setRunId] = useState(null)
  const pollRef = useRef(null)
  const failsRef = useRef(0) // fallos de red consecutivos en el polling

  // Tolerancia a parpadeos de internet: reintenta el polling varias veces antes
  // de marcar error (la corrida sigue en el servidor durante el corte).
  const MAX_POLL_FAILS = 6

  const configured = Boolean(supabase)

  const stop = useCallback(() => {
    if (pollRef.current) {
      clearTimeout(pollRef.current)
      pollRef.current = null
    }
  }, [])

  useEffect(() => () => stop(), [stop])

  const poll = useCallback((id) => {
    pollRef.current = setTimeout(async () => {
      try {
        const { data, error: err } = await supabase.functions.invoke('run-engine', {
          body: { action: 'status', run_id: id },
        })
        if (err) throw err
        failsRef.current = 0 // conexión OK
        if (data.status === 'running') {
          poll(id)
          return
        }
        if (data.status === 'done') {
          setResult(data.result)
          setStatus('done')
        } else {
          setError(data.error || 'Error desconocido en la corrida')
          setStatus('error')
        }
      } catch (e) {
        // Parpadeo de red: reintentamos sin marcar error hasta agotar el margen.
        failsRef.current += 1
        if (failsRef.current < MAX_POLL_FAILS) {
          poll(id)
        } else {
          setError(
            'Se perdió la conexión con el motor. La corrida puede seguir en la nube; ' +
              'reabre el modal en un momento para ver el resultado.',
          )
          setStatus('error')
        }
      }
    }, 3000)
  }, [])

  const run = useCallback(
    async (directive) => {
      if (!supabase) {
        setError('Supabase no está configurado')
        setStatus('error')
        return
      }
      stop()
      failsRef.current = 0
      setStatus('running')
      setResult(null)
      setError(null)
      setRunId(null)
      try {
        const { data, error: err } = await supabase.functions.invoke('run-engine', {
          body: { action: 'start', directive },
        })
        if (err) throw err
        if (!data?.run_id) throw new Error(data?.error || 'El motor no devolvió run_id')
        setRunId(data.run_id)
        poll(data.run_id)
      } catch (e) {
        setError(e?.message || String(e))
        setStatus('error')
      }
    },
    [poll, stop],
  )

  const reset = useCallback(() => {
    stop()
    setStatus('idle')
    setResult(null)
    setError(null)
    setRunId(null)
  }, [stop])

  // Historial: últimas corridas (de agent_runs vía el proxy).
  const listRuns = useCallback(async (limit = 8) => {
    if (!supabase) return []
    try {
      const { data, error: err } = await supabase.functions.invoke('run-engine', {
        body: { action: 'list', limit },
      })
      if (err) throw err
      return data?.runs || []
    } catch {
      return []
    }
  }, [])

  // Abrir una corrida pasada: si sigue corriendo la seguimos; si terminó, traemos su resultado.
  const openRun = useCallback(
    async (runMeta) => {
      if (!supabase) return
      stop()
      failsRef.current = 0
      setRunId(runMeta.id)
      setError(null)
      setResult(null)
      setStatus('running')
      try {
        const { data, error: err } = await supabase.functions.invoke('run-engine', {
          body: { action: 'status', run_id: runMeta.id },
        })
        if (err) throw err
        if (data.status === 'running') {
          poll(runMeta.id)
        } else if (data.status === 'done') {
          setResult(data.result)
          setStatus('done')
        } else {
          setError(data.error || 'La corrida terminó con error')
          setStatus('error')
        }
      } catch (e) {
        setError(e?.message || String(e))
        setStatus('error')
      }
    },
    [poll, stop],
  )

  return { configured, status, result, error, runId, run, reset, listRuns, openRun }
}
