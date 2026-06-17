// Edge Function · daily-sales-report
//
// Disparada por pg_cron a las 07:00 hora Colombia (12:00 UTC). Hace que el agente
// "Inventarista CRM" genere el reporte de ventas y lo deje en una conversación
// nueva del chat, para que Brandon lo tenga listo al llegar.
//
//   • Lunes        → resumen de ventas de la SEMANA PASADA (period=last_week)
//   • Martes–Sábado→ ventas de AYER (period=yesterday)
//   • Domingo      → no genera nada (no hay ventas los domingos)
//
// Idempotencia: pg_cron + net.http_post NO garantizan exactly-once (puede reintentar).
// Por eso, antes de generar, verificamos que NO exista ya un reporte 'scheduled_report'
// de hoy (zona Bogota) para este agente; si existe, hacemos skip.
//
// Sigue el mismo patrón m2m que `heartbeat`: el cron la invoca con el service_role en
// Authorization; verify_jwt (plataforma) es el gate.
import { runAgentChatTurn } from '../_shared/agent_chat.ts'
import { adminDb } from '../_shared/db.ts'

const AGENT_SLUG = 'inventarista-crm'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Max-Age': '86400',
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json; charset=utf-8' },
  })
}

// Instante UTC del inicio del día de hoy en Bogota (00:00 Bogota = 05:00 UTC).
function startOfBogotaDayUtc(nowMs = Date.now()): string {
  const b = new Date(nowMs - 5 * 3600_000)
  return new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate(), 5, 0, 0)).toISOString()
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS })
  }

  const db = adminDb()
  const { data: agent, error } = await db
    .from('agents')
    .select('id, status')
    .eq('slug', AGENT_SLUG)
    .maybeSingle()
  if (error) return json({ error: error.message }, 500)
  if (!agent) return json({ error: `Agente "${AGENT_SLUG}" no existe` }, 404)
  if (agent.status === 'disabled') return json({ ok: true, skipped: 'agente deshabilitado' })

  // Día de la semana en hora Colombia (UTC-5): 0=domingo … 6=sábado.
  const bogotaDow = new Date(Date.now() - 5 * 3600_000).getUTCDay()
  if (bogotaDow === 0) {
    return json({ ok: true, skipped: 'domingo — sin reporte' })
  }

  // Idempotencia: ¿ya generamos el reporte de hoy (Bogota) para este agente?
  const { data: already, error: dupErr } = await db
    .from('messages')
    .select('id')
    .eq('agent_id', agent.id)
    .eq('metadata->>source', 'scheduled_report')
    .gte('created_at', startOfBogotaDayUtc())
    .limit(1)
  if (dupErr) return json({ error: dupErr.message }, 500)
  if (already && already.length > 0) {
    return json({ ok: true, skipped: 'el reporte de hoy ya fue generado' })
  }

  const isMonday = bogotaDow === 1
  const prompt = isMonday
    ? 'Es lunes. Usa la herramienta suitecrm_sales con period="last_week" y entrégame el RESUMEN DE VENTAS DE LA SEMANA PASADA: total en pesos, desglose por día y por sucursal, y las facturas más grandes. Formato ejecutivo y claro.'
    : 'Usa la herramienta suitecrm_sales con period="yesterday" y entrégame el REPORTE DE VENTAS DE AYER: total en pesos, desglose por sucursal y las facturas más grandes. Formato ejecutivo y claro.'

  try {
    // conversation_id null → crea un hilo nuevo (título derivado del mensaje).
    // callerId null → el sistema (sin usuario). triggerMeta marca el origen para la UI.
    const result = await runAgentChatTurn(agent.id, prompt, null, null, { source: 'scheduled_report' })
    return json({ ok: true, report: isMonday ? 'last_week' : 'yesterday', ...result })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
