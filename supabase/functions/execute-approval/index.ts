// Edge Function · execute-approval
//
// Cuando la Junta aprueba una solicitud, este endpoint:
//   1. Verifica que el approval existe y está en status='approved'.
//   2. Ejecuta la operación real con los args guardados en payload.
//   3. Registra el resultado como tool_call + message role='tool' en el
//      agente solicitante, para que en su próximo tick "vea" el resultado.
//   4. Reactiva la task del agente (blocked → in_progress) para que el cron
//      la procese.
//
// Por ahora soporta el tool_name "shopify_adjust_inventory". Es trivial
// agregar otros tool_names al switch.
//
// Auth: requiere JWT del caller. Verifica que sea 'junta'.
import { createClient } from 'jsr:@supabase/supabase-js@^2'
import { adminDb } from '../_shared/db.ts'
import { shopifyAdjustInventory } from '../_shared/shopify.ts'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Max-Age': '86400',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS })
  }

  const authHeader = req.headers.get('Authorization') ?? ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) return json({ error: 'Falta Authorization' }, 401)

  // Verifica identidad del caller
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: userData, error: userErr } = await callerClient.auth.getUser(token)
  if (userErr || !userData?.user) return json({ error: 'Token inválido' }, 401)

  const admin = adminDb()
  const { data: profile } = await admin
    .from('profiles')
    .select('role')
    .eq('id', userData.user.id)
    .maybeSingle()
  if (!profile || profile.role !== 'junta') {
    return json({ error: 'Sólo la Junta Directiva puede ejecutar aprobaciones' }, 403)
  }

  let body: { approval_id?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Body JSON inválido' }, 400)
  }
  const approvalId = body.approval_id?.trim()
  if (!approvalId) return json({ error: 'Falta approval_id' }, 400)

  // Trae el approval
  const { data: approval, error: appErr } = await admin
    .from('approvals')
    .select('*')
    .eq('id', approvalId)
    .maybeSingle()
  if (appErr) return json({ error: appErr.message }, 500)
  if (!approval) return json({ error: 'Approval no encontrado' }, 404)
  if (approval.status !== 'approved') {
    return json({ error: `Approval está en estado ${approval.status}, no se puede ejecutar` }, 400)
  }

  const payload = approval.payload as { tool_name?: string; args?: Record<string, unknown> } | null
  const toolName = payload?.tool_name
  const args = (payload?.args ?? {}) as Record<string, unknown>
  if (!toolName) {
    return json({ ok: true, skipped: true, note: 'Approval sin tool_name en payload — nada que ejecutar' })
  }

  // Ejecuta según tool_name
  let toolResult: { ok: boolean; data?: unknown; error?: string }
  const startedAt = Date.now()
  try {
    if (toolName === 'shopify_adjust_inventory') {
      const sku = args.sku as string
      const locationId = args.location_id as string
      const delta = Number(args.delta)
      const reason = (args.reason as string) || 'aprobado-por-junta'
      const result = await shopifyAdjustInventory(sku, locationId, delta, reason)
      toolResult = { ok: true, data: { ...result, delta_applied: delta, reason, executed_after_approval: true } }
    } else {
      toolResult = { ok: false, error: `tool_name no soportado en execute-approval: ${toolName}` }
    }
  } catch (e) {
    toolResult = { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  const durationMs = Date.now() - startedAt

  // Registra el resultado: tool_call row + message role='tool' al agente.
  // El agente verá el resultado en su siguiente tick y continuará el flujo.
  const { data: tcRow } = await admin
    .from('tool_calls')
    .insert({
      agent_id: approval.agent_id,
      task_id: approval.task_id,
      tool_name: toolName,
      args,
      result: toolResult.data ?? null,
      error: toolResult.error ?? null,
      status: toolResult.ok ? 'success' : 'failed',
      duration_ms: durationMs,
      completed_at: new Date().toISOString(),
      approval_id: approval.id,
    })
    .select('id')
    .single()

  const toolMsg = JSON.stringify(toolResult)
  await admin.from('messages').insert({
    agent_id: approval.agent_id,
    task_id: approval.task_id,
    role: 'tool',
    content: toolMsg,
    metadata: { from_approval: approval.id, tool_call_id: tcRow?.id ?? null },
  })

  // Desbloquear la task del agente para que el cron la reprocese
  if (approval.task_id) {
    await admin.from('tasks').update({ status: 'in_progress' }).eq('id', approval.task_id)
  }

  return json({
    ok: true,
    executed: toolResult.ok,
    tool_name: toolName,
    result: toolResult,
  })
})

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json; charset=utf-8' },
  })
}
