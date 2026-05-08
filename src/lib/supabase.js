import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isSupabaseConfigured = Boolean(url && anon)

if (typeof window !== 'undefined') {
  // Marca visible para debug rápido desde DevTools (window.__crm)
  window.__crm = {
    supabase: isSupabaseConfigured,
    url: isSupabaseConfigured ? url : null,
  }
  if (isSupabaseConfigured) {
    console.info('[CRM-AI] Conectado a Supabase:', url)
  } else {
    console.warn('[CRM-AI] Modo local — Supabase no configurado')
  }
}

export const supabase = isSupabaseConfigured
  ? createClient(url, anon, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      realtime: { params: { eventsPerSecond: 10 } },
    })
  : null

if (supabase && typeof window !== 'undefined') {
  window.__crm.client = supabase
}
