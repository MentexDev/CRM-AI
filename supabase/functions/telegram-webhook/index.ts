// Edge Function · telegram-webhook
//
// Recibe updates de Telegram. Lo único que procesa son `callback_query`
// con datos en formato "approve:<approval_id>" o "reject:<approval_id>".
//
// Seguridad:
//   - verify_jwt=false (Telegram no manda JWT).
//   - Si TELEGRAM_WEBHOOK_SECRET está configurado, validamos el header
//     X-Telegram-Bot-Api-Secret-Token (Telegram lo envía cuando se setea
//     en setWebhook). Sin secret, rechazamos.
//   - Validamos que from.id está en TELEGRAM_ADMIN_CHAT_ID (csv para
//     permitir varios admins).
//
// Para configurar:
//   1. Crea bot con @BotFather. Copia el TOKEN.
//   2. Habla con @userinfobot para obtener tu chat_id.
//   3. En Supabase secrets:
//        TELEGRAM_BOT_TOKEN=...
//        TELEGRAM_ADMIN_CHAT_ID=12345  (o "12345,67890" para varios)
//        TELEGRAM_WEBHOOK_SECRET=<algo random largo>
//   4. Llama una vez:
//        curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
//          -H "Content-Type: application/json" \
//          -d '{
//            "url": "https://ccaufudzkgvrdxwmazwk.supabase.co/functions/v1/telegram-webhook",
//            "secret_token": "<TELEGRAM_WEBHOOK_SECRET>",
//            "allowed_updates": ["callback_query"]
//          }'
import { createClient } from 'jsr:@supabase/supabase-js@^2'
import { adminDb } from '../_shared/db.ts'

const TG_BASE = 'https://api.telegram.org'

interface TelegramCallbackQuery {
  id: string
  from: { id: number; first_name?: string; username?: string }
  message?: { chat: { id: number }; message_id: number; text?: string }
  data?: string
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const expectedSecret = Deno.env.get('TELEGRAM_WEBHOOK_SECRET')
  if (expectedSecret) {
    const provided = req.headers.get('X-Telegram-Bot-Api-Secret-Token') ?? ''
    if (provided !== expectedSecret) {
      return new Response('Forbidden', { status: 403 })
    }
  }

  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN')
  if (!botToken) {
    return new Response('Telegram no configurado', { status: 500 })
  }

  let update: { callback_query?: TelegramCallbackQuery }
  try {
    update = await req.json()
  } catch {
    return new Response('Bad request', { status: 400 })
  }

  const cb = update.callback_query
  if (!cb || !cb.data) {
    // Otros tipos de update no nos interesan
    return new Response('ok', { status: 200 })
  }

  // Verificar admin
  const allowedRaw = Deno.env.get('TELEGRAM_ADMIN_CHAT_ID') ?? ''
  const allowed = allowedRaw.split(',').map((s) => s.trim()).filter(Boolean)
  if (allowed.length === 0 || !allowed.includes(String(cb.from.id))) {
    await answerCallback(botToken, cb.id, 'No autorizado.')
    return new Response('ok', { status: 200 })
  }

  const [action, approvalId] = cb.data.split(':')
  if (!approvalId || (action !== 'approve' && action !== 'reject')) {
    await answerCallback(botToken, cb.id, 'Acción desconocida.')
    return new Response('ok', { status: 200 })
  }

  const admin = adminDb()

  // Resolvemos el user_id de junta para registrar quién decidió. Como
  // Telegram no se mapea 1:1 a auth.users, usamos el primer profile junta
  // como decided_by (es información auxiliar; lo importante es el status).
  const { data: juntaProfile } = await admin
    .from('profiles')
    .select('id')
    .eq('role', 'junta')
    .limit(1)
    .maybeSingle()

  // Actualizar el approval
  const { data: approval, error } = await admin
    .from('approvals')
    .update({
      status: action === 'approve' ? 'approved' : 'rejected',
      decided_by: juntaProfile?.id ?? null,
      decided_at: new Date().toISOString(),
      decision_note: `Decidido desde Telegram (${cb.from.username || cb.from.first_name || cb.from.id})`,
    })
    .eq('id', approvalId)
    .eq('status', 'pending') // sólo si sigue pending — evita double-decide
    .select('*')
    .maybeSingle()

  if (error) {
    await answerCallback(botToken, cb.id, `Error: ${error.message}`)
    return new Response('ok', { status: 200 })
  }
  if (!approval) {
    await answerCallback(botToken, cb.id, 'Esa aprobación ya fue decidida.')
    await editToFinal(botToken, cb, '⚠️ Esta aprobación ya había sido decidida.')
    return new Response('ok', { status: 200 })
  }

  // Si fue aprobada y tiene tool_name pendiente, ejecutar
  let execNote = ''
  if (action === 'approve' && approval.payload?.tool_name) {
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      const serviceClient = createClient(supabaseUrl, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
      const { data: execData, error: execErr } = await serviceClient.functions.invoke(
        'execute-approval',
        { body: { approval_id: approval.id } },
      )
      if (execErr) {
        execNote = `\n\n⚠️ Aprobado pero la ejecución falló: ${execErr.message}`
      } else if (execData?.executed === false) {
        execNote = `\n\n⚠️ Aprobado. La ejecución reportó: ${execData?.result?.error ?? 'error desconocido'}`
      } else {
        execNote = `\n\n✅ Ejecutado · ${approval.payload.tool_name}`
      }
    } catch (e) {
      execNote = `\n\n⚠️ Aprobado pero la ejecución lanzó: ${e instanceof Error ? e.message : String(e)}`
    }
  }

  await answerCallback(botToken, cb.id, action === 'approve' ? '✅ Aprobado' : '❌ Rechazado')
  const newText = action === 'approve'
    ? `✅ <b>APROBADO</b>\n\n${cb.message?.text ?? ''}${execNote}`
    : `❌ <b>RECHAZADO</b>\n\n${cb.message?.text ?? ''}`
  await editToFinal(botToken, cb, newText)

  return new Response('ok', { status: 200 })
})

async function answerCallback(token: string, queryId: string, text: string): Promise<void> {
  await fetch(`${TG_BASE}/bot${token}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: queryId, text }),
  }).catch(() => {})
}

async function editToFinal(
  token: string,
  cb: TelegramCallbackQuery,
  newText: string,
): Promise<void> {
  if (!cb.message) return
  await fetch(`${TG_BASE}/bot${token}/editMessageText`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: cb.message.chat.id,
      message_id: cb.message.message_id,
      text: newText,
      parse_mode: 'HTML',
    }),
  }).catch(() => {})
}
