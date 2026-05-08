// Cliente Supabase para Edge Functions con service_role.
// Bypass RLS — sólo se usa desde el runtime de los agentes.
import { createClient, SupabaseClient } from 'jsr:@supabase/supabase-js@^2'

export function adminDb(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) {
    throw new Error('SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY deben estar definidos en el entorno de la Edge Function')
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
