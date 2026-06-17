import { useEffect, useState } from 'react'
import { isSupabaseConfigured, supabase } from './supabase'

// Estado de conexión COMPARTIDO entre toda la app (un solo poller global).
//
// Antes TopBar y AdminLayout corrían CADA UNO su propio ping a `profiles` cada 30s →
// el doble de requests y el doble de ruido en consola cuando un ping cae con
// net::ERR_CONNECTION_CLOSED (conexión keep-alive que Supabase cierra por inactividad y
// el navegador intenta reusar; supabase-js reintenta y se recupera, pero el navegador
// igual loguea el intento fallido). Aquí corre UN solo ping cada 45s y los componentes
// se suscriben — menos requests = menos ruido. El fallo se maneja con gracia (solo marca
// 'offline' tras 2 fallos consecutivos).
//
// estados: 'idle' | 'online' | 'offline' | 'local'
let status = isSupabaseConfigured ? 'idle' : 'local'
let consecutiveFailures = 0
let started = false
const subscribers = new Set()

function setStatus(next) {
  if (next === status) return
  status = next
  for (const fn of subscribers) fn(status)
}

async function ping() {
  if (!isSupabaseConfigured) return
  try {
    const { error } = await supabase.from('profiles').select('id').limit(1)
    if (error) {
      consecutiveFailures += 1
      if (consecutiveFailures >= 2) setStatus('offline')
    } else {
      consecutiveFailures = 0
      setStatus('online')
    }
  } catch {
    consecutiveFailures += 1
    if (consecutiveFailures >= 2) setStatus('offline')
  }
}

function startOnce() {
  if (started || !isSupabaseConfigured) return
  started = true
  ping()
  setInterval(ping, 45000)
  window.addEventListener('online', () => {
    consecutiveFailures = 0
    ping()
  })
  window.addEventListener('offline', () => setStatus('offline'))
}

export function useConnectionStatus() {
  const [s, setS] = useState(status)
  useEffect(() => {
    startOnce()
    subscribers.add(setS)
    setS(status) // sincroniza con el valor actual al montar
    return () => {
      subscribers.delete(setS)
    }
  }, [])
  return s
}
