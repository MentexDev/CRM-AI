// Edge Function · execute-approval — ÚNICA vía para aprobar+ejecutar una solicitud.
//
//   1. Verifica JWT del caller y que sea 'junta'.
//   2. RECLAMA el approval atómicamente (pending/approved → 'executing') para que un
//      replay / doble-clic / retry NO re-ejecute (idempotencia: no reenvía correos).
//   3. Ejecuta: si trae payload.tool_name → la operación determinística (autónomo) +
//      reactiva la task; si nació de un chat (conversation_id) → re-invoca al agente.
//   4. Fija el estado terminal del approval: 'executed' (ok) o 'failed'.
//
// Auth: requiere JWT del caller. Verifica que sea 'junta'.
import { createClient } from 'jsr:@supabase/supabase-js@^2'
import { adminDb } from '../_shared/db.ts'
import { shopifyAdjustInventory } from '../_shared/shopify.ts'
import { deliverEmail } from '../_shared/tools.ts'
import { runAgentChatTurn } from '../_shared/agent_chat.ts'

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

  // CLAIM ATÓMICO (idempotencia · cierra H1+M1): solo UNA invocación gana. El UPDATE
  // condicional por status garantiza que un replay / doble-clic / retry NO re-ejecute
  // (no reenvía correos reales ni re-ajusta inventario). Aceptamos 'pending' (aprobar ES
  // esta llamada → execute-approval es la ÚNICA vía de transición; el panel ya no marca
  // 'approved' desde el cliente) y 'approved' (compat con quien lo marque aparte). Pasa a
  // 'executing' y registra la decisión. Si no devuelve fila → ya tomada/no reclamable.
  const { data: approval, error: claimErr } = await admin
    .from('approvals')
    .update({ status: 'executing', decided_by: userData.user.id, decided_at: new Date().toISOString() })
    .eq('id', approvalId)
    .in('status', ['pending', 'approved'])
    .select('*')
    .maybeSingle()
  if (claimErr) return json({ error: claimErr.message }, 500)
  if (!approval) {
    const { data: cur } = await admin.from('approvals').select('status').eq('id', approvalId).maybeSingle()
    if (!cur) return json({ error: 'Approval no encontrado' }, 404)
    return json({ ok: true, skipped: true, note: `Approval en estado ${cur.status} — ya ejecutada o no aprobable` })
  }

  const payload = approval.payload as { tool_name?: string; args?: Record<string, unknown> } | null
  const toolName = payload?.tool_name
  const args = (payload?.args ?? {}) as Record<string, unknown>

  // Estado terminal del approval tras ejecutar. 'executed' si ok; 'failed' si lanzó/falló
  // (terminal → no se re-reclama, sin doble-envío por reintento; la Junta re-decide a mano).
  const settle = (s: 'executed' | 'failed') =>
    admin.from('approvals').update({ status: s }).eq('id', approvalId)

  // 1) AUTÓNOMO / payload determinístico (args YA vetados por la Junta). Tiene prioridad
  //    sobre chat_resume para no re-derivar destinatarios en un envío sin gate (cierra N1).
  if (toolName) {
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
      } else if (toolName === 'create_agent') {
        const { data: existing } = await admin
          .from('agents')
          .select('id')
          .eq('slug', args.slug as string)
          .maybeSingle()
        if (existing) {
          toolResult = { ok: false, error: `Ya existe un agente con slug "${args.slug}"` }
        } else {
          const { data: newAgent, error: agentErr } = await admin
            .from('agents')
            .insert({
              name: args.name,
              slug: args.slug,
              role: args.role,
              specialty: args.specialty ?? null,
              brand_id: args.brand_id ?? null,
              parent_agent_id: args.parent_agent_id ?? null,
              system_prompt: args.system_prompt,
              allowed_tools: args.allowed_tools ?? [],
              model: args.model ?? 'llama-3.3-70b-versatile',
              provider: 'groq',
              status: 'idle',
            })
            .select('id, slug, name')
            .single()
          if (agentErr) {
            toolResult = { ok: false, error: agentErr.message }
          } else {
            toolResult = {
              ok: true,
              data: {
                agent_id: newAgent.id,
                slug: newAgent.slug,
                name: newAgent.name,
                note: `Agente "${newAgent.name}" creado y activo.`,
                executed_after_approval: true,
              },
            }
          }
        }
      } else if (toolName === 'send_email') {
        const recipients = String(args.to ?? '').split(',').map((s) => s.trim()).filter(Boolean)
        toolResult = await deliverEmail(recipients, String(args.subject ?? ''), String(args.body ?? ''))
      } else {
        toolResult = { ok: false, error: `tool_name no soportado en execute-approval: ${toolName}` }
      }
    } catch (e) {
      toolResult = { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
    const durationMs = Date.now() - startedAt

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

    await admin.from('messages').insert({
      agent_id: approval.agent_id,
      task_id: approval.task_id,
      conversation_id: approval.conversation_id ?? null,
      role: 'tool',
      content: JSON.stringify(toolResult),
      metadata: { from_approval: approval.id, tool_call_id: tcRow?.id ?? null },
    })

    if (approval.task_id) {
      await admin.from('tasks').update({ status: 'in_progress' }).eq('id', approval.task_id)
    }

    await settle(toolResult.ok ? 'executed' : 'failed')
    return json({ ok: true, executed: toolResult.ok, tool_name: toolName, result: toolResult })
  }

  // 2) CHAT: la aprobación nació de una conversación → el agente "continúa solo". Le
  //    re-invocamos un turno con un aviso de aprobación; él ejecuta lo solicitado (p.ej.
  //    send_email, reutilizando el correo ya compuesto) y postea el resultado + su cierre
  //    AL HILO (visible por realtime). Automatiza el "ya lo aprobaron" manual.
  if (approval.conversation_id) {
    const note =
      `✅ La Junta aprobó tu solicitud${approval.summary ? `: «${approval.summary}»` : ''}. ` +
      'Procede a ejecutarla ahora mismo (si es un correo, envíalo).'
    try {
      const result = await runAgentChatTurn(
        approval.agent_id,
        note,
        approval.conversation_id,
        userData.user.id,
        { source: 'approval_resume' },
      )
      await settle('executed')
      return json({ ok: true, mode: 'chat_resume', result })
    } catch (e) {
      await settle('failed')
      return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500)
    }
  }

  // 3) Sin acción ejecutable ni conversación: nada que hacer (decisión registrada).
  await settle('executed')
  return json({ ok: true, skipped: true, note: 'Approval sin acción ejecutable' })
})

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json; charset=utf-8' },
  })
}
