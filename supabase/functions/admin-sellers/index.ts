// Edge Function: admin-sellers
//
// Crea y elimina vendedoras usando la service_role key de Supabase, así la
// operación es 100% server-side y no afecta la sesión del admin en el navegador.
//
// Verifica que el caller esté autenticado y tenga role='admin' en profiles.
//
// Endpoint POST /functions/v1/admin-sellers
// Body:
//   { action: 'create', email, password, username, first_name, last_name }
//   { action: 'delete', user_id }

import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Sin autenticación' }, 401)

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    if (!supabaseUrl || !anonKey || !serviceKey) {
      return json({ error: 'Función mal configurada' }, 500)
    }

    // 1) Verificar quién es el caller (su JWT)
    const caller = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: userData, error: userErr } = await caller.auth.getUser()
    if (userErr || !userData.user) return json({ error: 'Token inválido' }, 401)

    const { data: profile, error: profErr } = await caller
      .from('profiles')
      .select('role')
      .eq('id', userData.user.id)
      .single()
    if (profErr || profile?.role !== 'admin') {
      return json({ error: 'Solo admin' }, 403)
    }

    // 2) Cliente service_role para operaciones admin
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const body = await req.json()
    const { action } = body || {}

    if (action === 'create') {
      const { email, password, username, first_name, last_name } = body
      if (!email || !password) return json({ error: 'Faltan email/password' }, 400)

      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          username,
          first_name,
          last_name,
          role: 'seller',
        },
      })
      if (error) return json({ error: error.message }, 400)
      return json({ id: data.user?.id, email: data.user?.email })
    }

    if (action === 'delete') {
      const { user_id } = body
      if (!user_id) return json({ error: 'Falta user_id' }, 400)

      // No permitir auto-eliminación
      if (user_id === userData.user.id) {
        return json({ error: 'No puedes eliminar tu propia cuenta' }, 400)
      }

      const { error } = await admin.auth.admin.deleteUser(user_id)
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }

    return json({ error: 'Acción inválida' }, 400)
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
})
