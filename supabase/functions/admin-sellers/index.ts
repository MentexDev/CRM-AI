// Edge Function: admin-sellers (slug en producción: quick-action)
//
// Maneja TODO el flujo de crear/eliminar vendedoras en server-side con
// service_role para que el cliente del admin no tenga que hacer ninguna
// operación de DB después del fetch a esta función. Esto evita que la
// sesión del admin se vea afectada por race conditions del SDK.
//
// Endpoint POST /functions/v1/quick-action
// Body:
//   { action: 'create', email, password, username, first_name, last_name, goal? }
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

    // 2) Cliente service_role para todas las operaciones admin (incluida
    //    la verificación del role para no depender de RLS)
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data: profile } = await admin
      .from('profiles')
      .select('role')
      .eq('id', userData.user.id)
      .single()
    if (profile?.role !== 'admin') {
      return json({ error: 'Solo admin' }, 403)
    }

    const body = await req.json()
    const { action } = body || {}

    if (action === 'create') {
      const { email, password, username, first_name, last_name, goal } = body
      if (!email || !password) return json({ error: 'Faltan email/password' }, 400)

      // Verificar duplicado por username (case-insensitive)
      if (username) {
        const { data: existing } = await admin
          .from('profiles')
          .select('id')
          .ilike('username', username)
          .maybeSingle()
        if (existing) return json({ error: `El usuario ${username} ya existe` }, 400)
      }

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

      const userId = data.user?.id
      // Update goal en el profile creado por el trigger
      if (userId && goal !== undefined && goal !== null) {
        await admin
          .from('profiles')
          .update({ goal: Number(goal) || 3000000 })
          .eq('id', userId)
      }

      return json({ id: userId, email: data.user?.email })
    }

    if (action === 'delete') {
      const { user_id } = body
      if (!user_id) return json({ error: 'Falta user_id' }, 400)

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
