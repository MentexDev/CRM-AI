// Edge Function · heartbeat
//
// El "latido" del sistema. Programada vía `pg_cron` (cada minuto).
// Encuentra agentes con tareas activas (to_do o in_progress) y ejecuta un
// tick para cada uno secuencialmente, con una concurrencia chiquita para
// evitar choque de rate-limits del LLM.
//
// Idempotente: si una invocación cae a mitad, la siguiente recoge.
import { adminDb } from '../_shared/db.ts'
import { runAgentStep } from '../_shared/agent_step.ts'

const MAX_CONCURRENCY = 3
const MAX_AGENTS_PER_TICK = 10

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Max-Age': '86400',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }
  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS })
  }

  const startedAt = Date.now()
  const db = adminDb()

  // F5 gobernanza + F4 backstop (cada tick, best-effort):
  // 1) reconcile_stuck_tasks: tareas sin progreso >45min o en loop (>50 turnos del
  //    agente) → 'needs_review' (no cuelgan ni queman tokens; un humano las mira).
  // 2) reconcile_blocked_parents: padres 'blocked' cuyos hijos ya quedaron terminales
  //    (incluye los recién marcados) y sin aprobación pendiente → reactivados.
  //    Auto-sana atascos (hijo que no termina) y carreras (hijos concurrentes).
  await db.rpc('reconcile_stuck_tasks')
  await db.rpc('reconcile_blocked_parents')

  const { data: rows, error } = await db
    .from('tasks')
    .select('agent_id, agents!inner(id, slug, status)')
    .in('status', ['to_do', 'in_progress'])
    .not('agent_id', 'is', null)
    .limit(200)

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
    })
  }

  const seen = new Set<string>()
  const targets: { agent_id: string; slug: string }[] = []
  for (const r of rows ?? []) {
    const aid = r.agent_id as string
    if (!aid || seen.has(aid)) continue
    const ag = (r as { agents?: { status?: string; slug?: string } }).agents
    if (!ag || ag.status === 'disabled' || ag.status === 'running') continue
    seen.add(aid)
    targets.push({ agent_id: aid, slug: ag.slug ?? aid })
    if (targets.length >= MAX_AGENTS_PER_TICK) break
  }

  const results: unknown[] = []
  for (let i = 0; i < targets.length; i += MAX_CONCURRENCY) {
    const batch = targets.slice(i, i + MAX_CONCURRENCY)
    const settled = await Promise.allSettled(
      batch.map((t) =>
        runAgentStep(t.agent_id).then((r) => ({ slug: t.slug, ...r })),
      ),
    )
    for (const s of settled) {
      if (s.status === 'fulfilled') results.push(s.value)
      else results.push({ error: String(s.reason) })
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      ticked: targets.length,
      duration_ms: Date.now() - startedAt,
      results,
    }),
    { headers: { ...CORS_HEADERS, 'content-type': 'application/json' } },
  )
})
