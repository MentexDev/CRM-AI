// =====================================================================
// Edge Function: agent-run
// Persistencia de las corridas del motor agéntico (tabla agent_runs).
//
//   action: "create" { run_id, directive }            → inserta (status running)
//   action: "finish" { run_id, status, result, error } → actualiza el resultado
//   action: "get"    { run_id }                        → devuelve la corrida
//
// Autocontenida, verify_jwt=false. Usa service_role (RLS no aplica).
// =====================================================================
import { createClient } from 'jsr:@supabase/supabase-js@^2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Body JSON inválido' }, 400)
  }

  const action = (body.action as string | undefined)?.trim()
  const runId = (body.run_id as string | undefined)?.trim()
  if (!runId) return json({ error: 'Falta run_id' }, 400)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceKey) return json({ error: 'Entorno no configurado' }, 500)
  const db = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  try {
    if (action === 'create') {
      const directive = (body.directive as string | undefined)?.trim()
      if (!directive) return json({ error: 'Falta directive' }, 400)
      const { error } = await db
        .from('agent_runs')
        .insert({ id: runId, directive, status: 'running' })
      if (error) return json({ ok: false, error: error.message }, 422)
      return json({ ok: true, action, run_id: runId, status: 'running' })
    }

    if (action === 'finish') {
      const status = (body.status as string | undefined)?.trim()
      if (status !== 'done' && status !== 'error') {
        return json({ error: "status debe ser 'done' o 'error'" }, 400)
      }
      const { error } = await db
        .from('agent_runs')
        .update({
          status,
          result: (body.result as string | undefined) ?? null,
          error: (body.error as string | undefined) ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', runId)
      if (error) return json({ ok: false, error: error.message }, 422)
      return json({ ok: true, action, run_id: runId, status })
    }

    if (action === 'get') {
      const { data, error } = await db
        .from('agent_runs')
        .select('id, directive, status, result, error, created_at, updated_at')
        .eq('id', runId)
        .maybeSingle()
      if (error) return json({ ok: false, error: error.message }, 422)
      if (!data) return json({ ok: true, action, found: false })
      return json({ ok: true, action, found: true, run: data })
    }

    return json({ error: "action debe ser 'create', 'finish' o 'get'" }, 400)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[agent-run] Error:', message)
    return json({ ok: false, error: message }, 500)
  }
})

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS, 'content-type': 'application/json; charset=utf-8' },
  })
}
