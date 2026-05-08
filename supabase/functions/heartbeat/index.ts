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

Deno.serve(async (req) => {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 })
  }

  const startedAt = Date.now()
  const db = adminDb()

  // Encontrar agentes únicos con tareas activas, descartando los disabled
  // y los que ya están en running (otro tick en vuelo).
  const { data: rows, error } = await db
    .from('tasks')
    .select('agent_id, agents!inner(id, slug, status)')
    .in('status', ['to_do', 'in_progress'])
    .not('agent_id', 'is', null)
    .limit(200)

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
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
    { headers: { 'content-type': 'application/json' } },
  )
})
