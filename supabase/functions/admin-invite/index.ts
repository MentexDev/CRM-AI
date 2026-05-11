// Edge Function · admin-invite
//
// Invita un nuevo usuario al holding por email. Sólo la Junta Directiva
// puede invocarla. El invitado recibe un magic link de Supabase; al hacer
// click y crear su password, el trigger handle_new_user() aplica el rol
// y los brand_memberships que se mandaron como metadata.
//
// Body esperado:
//   { email, role?, full_name?, brand_ids?, brand_role? }
//
// Auth: requiere Authorization: Bearer <JWT del usuario actual>. El JWT se
// usa para verificar que el invocador es 'junta' antes de delegar al
// service_role admin client.
import { createClient } from 'jsr:@supabase/supabase-js@^2'
import { adminDb } from '../_shared/db.ts'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Max-Age': '86400',
}

const VALID_GLOBAL_ROLES = new Set(['junta', 'admin', 'member', 'viewer'])
const VALID_BRAND_ROLES = new Set(['admin', 'manager', 'member', 'viewer'])

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS })
  }

  const authHeader = req.headers.get('Authorization') ?? ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) return json({ error: 'Falta Authorization' }, 401)

  // Verificar que el caller es junta — usamos un cliente con SU token
  // (no service_role) para que respete RLS y nos devuelva su user_id real.
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: userData, error: userErr } = await callerClient.auth.getUser(token)
  if (userErr || !userData?.user) return json({ error: 'Token inválido' }, 401)

  const admin = adminDb()
  const { data: profile, error: profErr } = await admin
    .from('profiles')
    .select('role')
    .eq('id', userData.user.id)
    .maybeSingle()
  if (profErr) return json({ error: profErr.message }, 500)
  if (!profile || profile.role !== 'junta') {
    return json({ error: 'Sólo la Junta Directiva puede invitar usuarios' }, 403)
  }

  // Parsear body
  let body: {
    email?: string
    role?: string
    full_name?: string
    brand_ids?: string[]
    brand_role?: string
  }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Body JSON inválido' }, 400)
  }

  const email = (body.email || '').trim().toLowerCase()
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: 'Email inválido' }, 400)
  }

  const role = body.role && VALID_GLOBAL_ROLES.has(body.role) ? body.role : 'member'
  const brand_role =
    body.brand_role && VALID_BRAND_ROLES.has(body.brand_role) ? body.brand_role : 'member'
  const brand_ids = Array.isArray(body.brand_ids)
    ? body.brand_ids.filter((id) => typeof id === 'string' && id.length > 0)
    : []
  const full_name = (body.full_name || '').trim() || undefined

  // Mandar el invite con metadata. El trigger handle_new_user lo lee.
  const { data: inviteData, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
    data: {
      role,
      brand_role,
      brand_ids,
      full_name,
      invited_by: userData.user.id,
    },
  })
  if (inviteErr) {
    const msg = inviteErr.message || String(inviteErr)
    // Si el email ya existe en auth.users, Supabase devuelve un error específico
    if (msg.toLowerCase().includes('already')) {
      return json({ error: `Ya existe un usuario con email ${email}` }, 409)
    }
    return json({ error: msg }, 500)
  }

  return json({
    ok: true,
    user_id: inviteData?.user?.id,
    email,
    role,
    brand_count: brand_ids.length,
  })
})

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json; charset=utf-8' },
  })
}
