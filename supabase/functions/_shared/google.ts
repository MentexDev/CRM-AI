// Auth a las APIs de Google vía SERVICE ACCOUNT (JWT bearer grant) — sin OAuth de usuario.
// El agente actúa como la cuenta de servicio sobre un calendario de marca COMPARTIDO con
// ella. Requiere los secrets:
//   GOOGLE_SERVICE_ACCOUNT_JSON  → el JSON completo de la llave del service account
//   GOOGLE_CALENDAR_ID           → el id del calendario compartido (ej. ...@group.calendar.google.com)
//
// Firma el JWT con RS256 usando Web Crypto (sin dependencias). Cachea el access_token
// en memoria del worker hasta ~1 min antes de expirar.

interface ServiceAccount {
  client_email: string
  private_key: string
  token_uri?: string
}

function getServiceAccount(): ServiceAccount | null {
  const raw = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON')
  if (!raw) return null
  try {
    const sa = JSON.parse(raw)
    if (!sa.client_email || !sa.private_key) return null
    return sa as ServiceAccount
  } catch {
    return null
  }
}

export function googleCalendarId(): string | null {
  return Deno.env.get('GOOGLE_CALENDAR_ID') ?? null
}

export function googleConfigured(): boolean {
  return !!getServiceAccount() && !!googleCalendarId()
}

// PEM (PKCS8) → ArrayBuffer (DER) para crypto.subtle.importKey.
function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '')
  const bin = atob(b64)
  const buf = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
  return buf.buffer
}

function base64url(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

let cached: { token: string; exp: number; scope: string } | null = null

export async function getGoogleAccessToken(scope: string): Promise<string> {
  const sa = getServiceAccount()
  if (!sa) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON no está configurado en los secrets')

  const now = Math.floor(Date.now() / 1000)
  if (cached && cached.scope === scope && cached.exp > now + 60) return cached.token

  const tokenUri = sa.token_uri || 'https://oauth2.googleapis.com/token'
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = base64url(JSON.stringify({ iss: sa.client_email, scope, aud: tokenUri, iat: now, exp: now + 3600 }))
  const unsigned = `${header}.${claims}`

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = new Uint8Array(
    await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned)),
  )
  const jwt = `${unsigned}.${base64url(sig)}`

  const resp = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  })
  const data = await resp.json().catch(() => ({}))
  if (!resp.ok || !data.access_token) {
    throw new Error(`Google token error: ${JSON.stringify(data).slice(0, 200)}`)
  }
  cached = { token: data.access_token, exp: now + (Number(data.expires_in) || 3600), scope }
  return data.access_token as string
}

const CAL_SCOPE = 'https://www.googleapis.com/auth/calendar'
const CAL_BASE = 'https://www.googleapis.com/calendar/v3/calendars'
const TZ = 'America/Bogota' // marca colombiana (NINA / Jeans Colombianos)

export interface CalendarEventInput {
  title: string
  description?: string
  startDateTime?: string // ISO con hora
  endDateTime?: string
  date?: string // YYYY-MM-DD para evento de día completo
}

export async function calendarCreateEvent(calendarId: string, e: CalendarEventInput) {
  const token = await getGoogleAccessToken(CAL_SCOPE)
  const body: Record<string, unknown> = { summary: e.title, description: e.description ?? undefined }
  if (e.date) {
    body.start = { date: e.date }
    body.end = { date: e.date }
  } else {
    const start = e.startDateTime!
    // Si no dan fin, +1h sobre el inicio.
    const end = e.endDateTime || new Date(new Date(start).getTime() + 3600_000).toISOString()
    body.start = { dateTime: start, timeZone: TZ }
    body.end = { dateTime: end, timeZone: TZ }
  }
  const resp = await fetch(`${CAL_BASE}/${encodeURIComponent(calendarId)}/events`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await resp.json().catch(() => ({}))
  if (!resp.ok) throw new Error(`Calendar ${resp.status}: ${JSON.stringify(data).slice(0, 200)}`)
  return { id: data.id, html_link: data.htmlLink, start: data.start, end: data.end, summary: data.summary }
}

export async function calendarListEvents(calendarId: string, opts: { timeMin?: string; timeMax?: string; max?: number }) {
  const token = await getGoogleAccessToken(CAL_SCOPE)
  const params = new URLSearchParams({
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: String(Math.min(opts.max ?? 10, 50)),
    timeMin: opts.timeMin || new Date().toISOString(),
  })
  if (opts.timeMax) params.set('timeMax', opts.timeMax)
  const resp = await fetch(`${CAL_BASE}/${encodeURIComponent(calendarId)}/events?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const data = await resp.json().catch(() => ({}))
  if (!resp.ok) throw new Error(`Calendar ${resp.status}: ${JSON.stringify(data).slice(0, 200)}`)
  const events = (data.items ?? []).map((it: Record<string, any>) => ({
    id: it.id,
    title: it.summary ?? '(sin título)',
    start: it.start?.dateTime ?? it.start?.date,
    end: it.end?.dateTime ?? it.end?.date,
    html_link: it.htmlLink,
  }))
  return { events, count: events.length }
}
