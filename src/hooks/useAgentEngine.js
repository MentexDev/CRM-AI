import { useCallback, useEffect, useRef, useState } from 'react'

// Cliente del motor agéntico desplegado (Railway). Lanza una corrida del Crew
// y hace polling del estado. Config por env: VITE_ENGINE_URL / VITE_ENGINE_KEY.
const ENGINE_URL = import.meta.env.VITE_ENGINE_URL
const ENGINE_KEY = import.meta.env.VITE_ENGINE_KEY

export function useAgentEngine() {
  const [status, setStatus] = useState('idle') // idle | running | done | error
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [runId, setRunId] = useState(null)
  const pollRef = useRef(null)

  const configured = Boolean(ENGINE_URL)

  const stop = useCallback(() => {
    if (pollRef.current) {
      clearTimeout(pollRef.current)
      pollRef.current = null
    }
  }, [])

  useEffect(() => () => stop(), [stop])

  const headers = () => {
    const h = { 'Content-Type': 'application/json' }
    if (ENGINE_KEY) h['X-Engine-Key'] = ENGINE_KEY
    return h
  }

  const poll = useCallback((id) => {
    pollRef.current = setTimeout(async () => {
      try {
        const r = await fetch(`${ENGINE_URL}/runs/${id}`, { headers: headers() })
        const data = await r.json()
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
        setError(String(e?.message || e))
        setStatus('error')
      }
    }, 3000)
  }, [])

  const run = useCallback(
    async (directive) => {
      if (!ENGINE_URL) {
        setError('VITE_ENGINE_URL no está configurado')
        setStatus('error')
        return
      }
      stop()
      setStatus('running')
      setResult(null)
      setError(null)
      setRunId(null)
      try {
        const r = await fetch(`${ENGINE_URL}/runs`, {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({ directive }),
        })
        if (!r.ok) {
          const t = await r.text()
          throw new Error(`${r.status}: ${t.slice(0, 160)}`)
        }
        const data = await r.json()
        setRunId(data.run_id)
        poll(data.run_id)
      } catch (e) {
        setError(String(e?.message || e))
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

  return { configured, status, result, error, runId, run, reset }
}
