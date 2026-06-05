// =====================================================================
// Edge Function: agent-action
// Expone acciones REALES de flujo de proyecto a un motor agéntico externo
// (CrewAI), escribiendo a las mismas tablas que lee la UI del CRM:
//
//   action: "create_task"      → crea una tarea (aparece en la página Tareas)
//   action: "request_approval" → crea una aprobación pendiente (página Aprobaciones)
//
// Carga el agente para resolver su brand_id y respeta los valores que el CRM
// y la UI esperan (status, trigger, etc.). Autocontenida (deploy de un archivo).
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
  const agentId = (body.agent_id as string | undefined)?.trim()
  if (!agentId) return json({ error: 'Falta agent_id' }, 400)
  if (action !== 'create_task' && action !== 'request_approval') {
    return json({ error: "action debe ser 'create_task' o 'request_approval'" }, 400)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceKey) {
    return json({ error: 'Variables de entorno no configuradas' }, 500)
  }
  const db = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Resolver el agente (para brand_id y validación)
  const { data: agent, error: aErr } = await db
    .from('agents')
    .select('id, name, brand_id')
    .eq('id', agentId)
    .maybeSingle()
  if (aErr) return json({ ok: false, error: aErr.message }, 422)
  if (!agent) return json({ ok: false, error: 'Agente no encontrado' }, 404)

  try {
    if (action === 'create_task') {
      const title = (body.title as string | undefined)?.trim()
      if (!title) return json({ error: 'Falta title' }, 400)
      const priority = typeof body.priority === 'number' ? body.priority : 3

      // Idempotencia: si el agente ya creó una tarea con el mismo título en los
      // últimos 30 min, devolvemos esa (evita duplicados si el LLM repite la llamada).
      const since = new Date(Date.now() - 30 * 60 * 1000).toISOString()
      const { data: existing } = await db
        .from('tasks')
        .select('id')
        .eq('agent_id', agent.id)
        .eq('title', title)
        .gte('created_at', since)
        .maybeSingle()
      if (existing) {
        return json({ ok: true, action, task_id: existing.id, status: 'to_do', deduped: true })
      }

      const { data, error } = await db
        .from('tasks')
        .insert({
          brand_id: agent.brand_id,
          agent_id: agent.id,
          title,
          description: (body.description as string | undefined)?.trim() ?? null,
          status: 'to_do',
          priority,
          created_by_agent_id: agent.id,
          context: { created_via: 'agent-engine' },
        })
        .select('id')
        .single()
      if (error) return json({ ok: false, error: error.message }, 422)
      return json({ ok: true, action, task_id: data.id, status: 'to_do' })
    }

    // action === 'request_approval'
    // triggers admitidos por el check de la tabla:
    const ALLOWED_TRIGGERS = [
      'expense', 'public_publish', 'external_comm',
      'structural', 'inventory_threshold', 'agent_uncertain',
    ]
    const rawTrigger = (body.trigger as string | undefined)?.trim() || 'agent_uncertain'
    const trigger = ALLOWED_TRIGGERS.includes(rawTrigger) ? rawTrigger : 'agent_uncertain'
    const summary = (body.summary as string | undefined)?.trim()
    if (!summary) return json({ error: 'Falta summary' }, 400)

    // Idempotencia: si ya hay una aprobación pendiente idéntica de este agente, reusarla.
    const { data: existingAppr } = await db
      .from('approvals')
      .select('id')
      .eq('agent_id', agent.id)
      .eq('summary', summary)
      .eq('status', 'pending')
      .maybeSingle()
    if (existingAppr) {
      return json({ ok: true, action, approval_id: existingAppr.id, status: 'pending', deduped: true })
    }

    const { data, error } = await db
      .from('approvals')
      .insert({
        agent_id: agent.id,
        brand_id: agent.brand_id,
        trigger,
        summary,
        payload: (body.payload as object) ?? {},
        status: 'pending',
      })
      .select('id')
      .single()
    if (error) return json({ ok: false, error: error.message }, 422)
    return json({ ok: true, action, approval_id: data.id, status: 'pending' })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[agent-action] Error:', message)
    return json({ ok: false, error: message }, 500)
  }
})

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS, 'content-type': 'application/json; charset=utf-8' },
  })
}
