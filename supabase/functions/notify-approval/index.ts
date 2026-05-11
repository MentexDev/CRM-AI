// Edge Function · notify-approval
//
// Notifica al admin por Telegram cuando se crea una aprobación pendiente.
// La llama el trigger AFTER INSERT en approvals (vía pg_net).
//
// Auth: requiere Bearer del service_role (el trigger lo provee desde vault).
// Si no hay TELEGRAM_BOT_TOKEN configurado, devuelve ok sin error — el
// sistema sigue funcionando sin Telegram.
import { adminDb } from '../_shared/db.ts'

const TG_BASE = 'https://api.telegram.org'

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  let body: { approval_id?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Body JSON inválido' }, 400)
  }
  const approvalId = body.approval_id
  if (!approvalId) return json({ error: 'Falta approval_id' }, 400)

  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN')
  const chatId = Deno.env.get('TELEGRAM_ADMIN_CHAT_ID')
  if (!botToken || !chatId) {
    // No configurado — silenciosamente skip. El front sigue mostrando el approval.
    return json({ ok: true, skipped: 'telegram_not_configured' })
  }

  const admin = adminDb()
  const { data: approval, error } = await admin
    .from('approvals')
    .select('id, summary, trigger, agent_id, brand_id, status, payload, agents(name, slug), brands(name, slug)')
    .eq('id', approvalId)
    .maybeSingle()
  if (error) return json({ error: error.message }, 500)
  if (!approval) return json({ error: 'Approval no encontrado' }, 404)
  if (approval.status !== 'pending') {
    return json({ ok: true, skipped: `status_${approval.status}` })
  }

  const agentName = (approval as any).agents?.name ?? 'Agente'
  const brandName = (approval as any).brands?.name ?? 'sin marca'
  const trigger = TRIGGER_LABEL[approval.trigger] ?? approval.trigger

  // Mensaje HTML con resumen + detalles colapsados (Telegram no soporta
  // collapsibles pero podemos meter pre con payload corto).
  const lines = [
    `<b>🔔 Aprobación pendiente · ${escapeHtml(brandName)}</b>`,
    '',
    `<b>Tipo:</b> ${escapeHtml(trigger)}`,
    `<b>Agente:</b> ${escapeHtml(agentName)}`,
    '',
    escapeHtml(approval.summary || '(sin resumen)'),
  ]
  const text = lines.join('\n')

  const sendResp = await fetch(`${TG_BASE}/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Aprobar', callback_data: `approve:${approval.id}` },
            { text: '❌ Rechazar', callback_data: `reject:${approval.id}` },
          ],
        ],
      },
    }),
  })

  if (!sendResp.ok) {
    const errText = await sendResp.text().catch(() => '')
    return json({ error: `Telegram ${sendResp.status}: ${errText.slice(0, 200)}` }, 502)
  }

  return json({ ok: true, approval_id: approvalId })
})

const TRIGGER_LABEL: Record<string, string> = {
  expense: 'Gasto / presupuesto',
  public_publish: 'Publicación pública',
  external_comm: 'Comunicación externa',
  structural: 'Cambio estructural',
  inventory_threshold: 'Movimiento de inventario',
  agent_uncertain: 'Agente con duda',
}

function escapeHtml(s: string): string {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}
