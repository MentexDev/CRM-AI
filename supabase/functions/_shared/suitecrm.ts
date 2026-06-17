// Integración con el SuiteCRM de Jeans Colombianos (crm.jeanscolombianos.com).
//
// La API REST v4_1 existe, pero el método `login` choca con la personalización
// "DefinirPeriodo" del CRM (responde 301 y redirige ANTES de devolver la sesión),
// así que NO la usamos. En su lugar autenticamos por el FORMULARIO WEB con cookies,
// igual que un navegador:
//   1) POST Authenticate            → cookie PHPSESSID
//   2) GET  DefinirPeriodo&auto=1    → fija el período en la sesión (si no, todo redirige)
//   3) GET  AOS_Invoices (list view) → búsqueda avanzada por invoice_date + parseo
//
// Dependencia de runtime: usamos fetch(redirect:'manual') leyendo headers/Set-Cookie
// del 301, y Headers.getSetCookie(). Esto funciona en Deno / Supabase Edge runtime
// (devuelven una respuesta `basic`, no `opaqueredirect`). En un runtime browser-like
// (redirect:'manual' ⇒ opaqueredirect sin headers) el login se rompería.
//
// El usuario de servicio está FIJO al período en curso (no tiene permiso para
// cambiarlo). Eso cubre "ventas de hoy/ayer/semana" DENTRO del mes actual; los rangos
// que cruzan el borde de mes pueden quedar incompletos (ver periodWarning()).
//
// Credenciales en los secrets de Supabase (Brandon las configura en el dashboard):
//   SUITECRM_USER, SUITECRM_PASS  (requeridas)
//   SUITECRM_URL                  (opcional; default al CRM de producción)

const DEFAULT_BASE = 'https://crm.jeanscolombianos.com/index.php'
const FETCH_TIMEOUT_MS = 15_000
const PAGE_SIZE = 50
const DEFAULT_MAX_PAGES = 30

function config(): { base: string; user: string; pass: string } {
  const base = Deno.env.get('SUITECRM_URL') ?? DEFAULT_BASE
  const user = Deno.env.get('SUITECRM_USER')
  const pass = Deno.env.get('SUITECRM_PASS')
  if (!user || !pass) {
    throw new Error('SuiteCRM no configurado: faltan SUITECRM_USER y SUITECRM_PASS en los secrets')
  }
  return { base, user, pass }
}

// fetch con timeout (AbortSignal) traducido a un Error legible. Convención del repo
// (ingest.ts usa AbortSignal.timeout). Sin esto, un CRM lento/colgado dejaría la
// promesa pendiente hasta el wall-clock de la plataforma.
async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
      throw new Error(`SuiteCRM no respondió a tiempo (>${FETCH_TIMEOUT_MS / 1000}s)`)
    }
    throw new Error(`SuiteCRM: fallo de red — ${msg}`)
  }
}

// --- Cookie jar mínimo (el fetch de Deno no maneja cookies por sí solo) ---
type Jar = Map<string, string>

function absorbCookies(headers: Headers, jar: Jar): void {
  // getSetCookie() es la API correcta (multi Set-Cookie). Fallback al header crudo;
  // si ninguno existe es un runtime sin soporte de cookies → mejor fallar claro luego.
  let list: string[] = []
  if (typeof headers.getSetCookie === 'function') list = headers.getSetCookie()
  else {
    const raw = headers.get('set-cookie')
    if (raw) list = [raw]
  }
  for (const raw of list) {
    const pair = raw.split(';', 1)[0]
    const eq = pair.indexOf('=')
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim())
  }
}

function cookieHeader(jar: Jar): string {
  return Array.from(jar, ([k, v]) => `${k}=${v}`).join('; ')
}

// ¿El HTML es la página de login (sesión caída / credenciales malas)? El form de
// login de SugarCRM trae username_password / action=Authenticate; las páginas
// autenticadas NO. Sirve para NO confundir "sesión perdida" con "0 ventas".
export function looksLikeLogin(html: string): boolean {
  return /name=["']?username_password["']?/i.test(html) || /action=Authenticate/i.test(html)
}

// ¿El Location del POST de login indica FALLO (credenciales malas)?
// OJO: un login EXITOSO redirige a `action=DefinirPeriodo` PERO con `return_action=Login`
// como parámetro — por eso anclamos el `action` real con [?&] (así `return_action=Login`
// NO matchea) y excluimos el redirect de éxito a DefinirPeriodo. Regresión: este detector
// nació de un falso positivo que marcaba un login válido como inválido.
export function isLoginFailureRedirect(location: string): boolean {
  if (!location) return false
  if (/action=DefinirPeriodo/i.test(location)) return false // redirect de ÉXITO
  return /[?&]action=Login(&|#|$)/i.test(location)
}

// Autentica por el formulario web y deja el período auto-definido en la sesión.
export async function suiteLogin(): Promise<Jar> {
  const { base, user, pass } = config()
  const jar: Jar = new Map()

  const body = new URLSearchParams({
    module: 'Users',
    action: 'Authenticate',
    return_module: 'Users',
    return_action: 'Login',
    user_name: user,
    username_password: pass,
  })
  const r1 = await fetchWithTimeout(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    redirect: 'manual',
  })
  absorbCookies(r1.headers, jar)
  await r1.body?.cancel()
  if (!jar.has('PHPSESSID')) {
    throw new Error('SuiteCRM login falló: no se recibió cookie de sesión (¿runtime sin Set-Cookie, o CRM caído?)')
  }
  // Un login OK redirige a DefinirPeriodo; un login con credenciales malas vuelve a
  // action=Login. PHPSESSID se setea en AMBOS casos, así que no alcanza con tenerla.
  if (isLoginFailureRedirect(r1.headers.get('location') ?? '')) {
    throw new Error('SuiteCRM login falló: credenciales inválidas (el CRM redirige a Login)')
  }

  // Sin esto, cualquier request autenticado redirige a DefinirPeriodo (301).
  const r2 = await fetchWithTimeout(`${base}?module=Users&action=DefinirPeriodo&auto=1`, {
    headers: { Cookie: cookieHeader(jar) },
    redirect: 'manual',
  })
  absorbCookies(r2.headers, jar)
  await r2.body?.cancel()

  return jar
}

export interface Invoice {
  id: string
  number: string // p.ej. "RM10266"
  client: string
  total: number
  invoice_date: string // MM/DD/YYYY (formato del CRM)
  branch: string
  date_entered: string
}

// Decodifica las entidades HTML más comunes (el list view escapa & < > " y nombres).
function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&#x?0*2f;/gi, '/')
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)))
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Extrae el texto de la celda <td field="..."> de un fragmento de fila. El list view
// de SuiteCRM marca cada celda con field="<columna>" → parseo por NOMBRE de campo
// (robusto ante cambios de orden de columnas). field se escapa por seguridad.
export function cell(rowSeg: string, field: string): string {
  const m = rowSeg.match(new RegExp(`field=["']${escapeRegex(field)}["'][^>]*>([\\s\\S]*?)</td>`, 'i'))
  if (!m) return ''
  // Saneamos como DATO no confiable: quitamos tags, decodificamos entidades, colapsamos
  // espacios y saltos de línea (mitiga prompt-injection vía nombres de cliente/sucursal).
  return decodeEntities(m[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}

// Convierte "$116,800.00" → 116800, y formato contable "($50.00)" o "$-50.00" → -50.
// Las notas crédito/devoluciones en estilo contable NO deben sumar como positivas.
export function parseAmount(raw: string): number {
  const s = (raw ?? '').trim()
  if (!s) return 0
  const negative = /^\(.*\)$/.test(s) || s.includes('-')
  const digits = s.replace(/[^0-9.]/g, '') // quita $ , ( ) - espacios
  const n = Number(digits)
  if (!Number.isFinite(n)) return 0
  return negative ? -n : n
}

// MM/DD/YYYY → número comparable YYYYMMDD (o null si no calza el formato).
export function mdyToNum(mdy: string): number | null {
  const m = mdy.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!m) return null
  return Number(m[3]) * 10000 + Number(m[1]) * 100 + Number(m[2])
}

function inRange(mdy: string, startMDY: string, endMDY: string): boolean {
  const d = mdyToNum(mdy)
  const a = mdyToNum(startMDY)
  const b = mdyToNum(endMDY)
  if (d == null || a == null || b == null) return true // sin fecha parseable, no descartamos
  return d >= a && d <= b
}

// Parsea las filas de factura del list view. Segmenta por el INICIO de cada fila
// ListRow (no por </tr>) para no truncar cuando hay tablas anidadas (menús de acción).
// El "gate" de fila es la presencia del checkbox mass[] (id), presente en TODA fila de
// registro sin importar qué columnas tenga configuradas el usuario.
export function parseInvoiceRows(html: string): Invoice[] {
  const out: Invoice[] = []
  const startRe = /<tr[^>]*\bclass=["'][^"']*ListRow[^"']*["'][^>]*>/gi
  const starts: number[] = []
  let m: RegExpExecArray | null
  while ((m = startRe.exec(html)) !== null) starts.push(m.index)

  for (let i = 0; i < starts.length; i++) {
    // Acotamos el segmento al inicio de la siguiente fila (o una ventana para la última,
    // para no arrastrar el footer de la página).
    const end = i + 1 < starts.length ? starts[i + 1] : Math.min(html.length, starts[i] + 8000)
    const seg = html.slice(starts[i], end)
    const idM = seg.match(/name=["']mass\[\]["']\s+value=["']([^"']+)["']/)
    if (!idM) continue
    out.push({
      id: idM[1],
      number: cell(seg, 'name'),
      client: cell(seg, 'billing_account'),
      total: parseAmount(cell(seg, 'total_amount')),
      invoice_date: cell(seg, 'invoice_date'),
      branch: cell(seg, 'sucursal_c'),
      date_entered: cell(seg, 'date_entered'),
    })
  }
  return out
}

// Lee el total de resultados de la paginación "(1 - 50 de 53)" — tolerante al idioma:
// acepta "de"/"of"/cualquier palabra entre los rangos y captura el ÚLTIMO número.
export function totalCount(html: string): number {
  const m = html.match(/\(\s*[\d.,]+\s*[-–]\s*[\d.,]+\s+\S+\s+([\d.,]+)\s*\)/)
  return m ? Number(m[1].replace(/[.,]/g, '')) : 0
}

// Trae TODAS las facturas con invoice_date en [startMDY, endMDY] inclusive, paginando
// el list view. Fechas en formato MM/DD/YYYY. Aplica DOBLE defensa:
//   - valida que cada respuesta sea realmente el list view (no login/redirect) → así un
//     fallo de sesión NO se confunde con "0 ventas" (devuelve error, no [] silencioso).
//   - filtra localmente por rango → si el filtro 'between' del CRM no aplicara, igual no
//     contaminamos el total con facturas fuera de rango (y maxPages acota el trabajo).
export async function getInvoicesInRange(
  jar: Jar,
  startMDY: string,
  endMDY: string,
  opts: { maxPages?: number } = {},
): Promise<Invoice[]> {
  const { base } = config()
  const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES
  const all: Invoice[] = []
  const seen = new Set<string>()

  for (let page = 0; page < maxPages; page++) {
    const qs = new URLSearchParams({
      module: 'AOS_Invoices',
      action: 'index',
      searchFormTab: 'advanced_search',
      query: 'true',
      invoice_date_advanced_range_choice: 'between',
      start_range_invoice_date_advanced: startMDY,
      end_range_invoice_date_advanced: endMDY,
      AOS_Invoices2_AOS_INVOICES_offset: String(page * PAGE_SIZE),
    })
    const resp = await fetchWithTimeout(`${base}?${qs}`, {
      headers: { Cookie: cookieHeader(jar) },
      redirect: 'manual',
    })
    // Una lectura autenticada del list view es 200. Un 3xx = la sesión/período se
    // perdió y el CRM redirige a login/DefinirPeriodo → NO es "0 ventas".
    if (resp.status >= 300 && resp.status < 400) {
      await resp.body?.cancel()
      throw new Error(`SuiteCRM redirigió la lectura de Facturas (status ${resp.status}); la sesión o el período no son válidos.`)
    }
    const html = await resp.text()
    if (looksLikeLogin(html)) {
      throw new Error('SuiteCRM devolvió la página de login al leer Facturas (sesión expirada o credenciales inválidas). No se asume "0 ventas".')
    }

    const rows = parseInvoiceRows(html)
    const total = totalCount(html)
    if (rows.length === 0) {
      // Si el CRM dice que hay resultados pero no reconocimos ninguna fila, es un fallo
      // de parseo (cambio de layout), NO un día sin ventas.
      if (total > 0 && page === 0) {
        throw new Error(`SuiteCRM reportó ${total} facturas pero no se reconoció ninguna fila (¿cambió el layout del list view?).`)
      }
      break
    }

    for (const inv of rows) {
      if (inv.id && seen.has(inv.id)) continue
      if (inv.id) seen.add(inv.id)
      if (!inRange(inv.invoice_date, startMDY, endMDY)) continue // red de seguridad
      all.push(inv)
    }

    if (total > 0 && (page + 1) * PAGE_SIZE >= total) break
  }
  return all
}

// Fecha de America/Bogota (UTC-5 fijo, sin horario de verano) desplazada `offsetDays`
// días, en formato MM/DD/YYYY (el que espera el buscador del CRM). `nowMs` inyectable
// para tests deterministas.
export function bogotaDate(offsetDays = 0, nowMs: number = Date.now()): string {
  const b = new Date(nowMs - 5 * 3600_000)
  b.setUTCDate(b.getUTCDate() - offsetDays)
  const mm = String(b.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(b.getUTCDate()).padStart(2, '0')
  return `${mm}/${dd}/${b.getUTCFullYear()}`
}

export interface SalesRange {
  start: string
  end: string
  label: string
}

// Traduce el `period` al rango [start,end] MM/DD/YYYY (zona Bogota). Inclusive en ambos
// extremos (el buscador 'between' es inclusivo), por eso los offsets evitan el off-by-one.
//   yesterday   = ayer                     (día anterior)
//   today       = hoy
//   last_7_days = 7 días terminando AYER   (no incluye hoy)
//   last_week   = lunes..domingo de la semana PASADA
export function salesRange(period: string, nowMs: number = Date.now()): SalesRange {
  const bd = (off: number) => bogotaDate(off, nowMs)
  switch (period) {
    case 'today':
      return { start: bd(0), end: bd(0), label: 'hoy' }
    case 'last_7_days':
      return { start: bd(7), end: bd(1), label: 'últimos 7 días (hasta ayer)' }
    case 'last_week': {
      const dow = new Date(nowMs - 5 * 3600_000).getUTCDay() // 0=domingo … 6=sábado
      const sinceMonday = (dow + 6) % 7
      return { start: bd(sinceMonday + 7), end: bd(sinceMonday + 1), label: 'semana pasada (lun–dom)' }
    }
    case 'yesterday':
    default:
      return { start: bd(1), end: bd(1), label: 'ayer' }
  }
}

// El usuario del CRM está fijo al período (mes) en curso. Si el rango pedido cae fuera de
// ese mes, el CRM puede no devolver esas facturas → avisamos para no reportar un total
// incompleto en silencio (ocurre el día 1 del mes, o en rangos semanales a caballo de mes).
export function periodWarning(startMDY: string, endMDY: string, nowMs: number = Date.now()): string | null {
  const ym = (mdy: string) => (mdyToNum(mdy) == null ? '' : mdy.slice(6) + mdy.slice(0, 2))
  const cur = ym(bogotaDate(0, nowMs))
  if (ym(startMDY) !== cur || ym(endMDY) !== cur) {
    return `Atención: el rango ${startMDY}–${endMDY} cae fuera del período en curso del CRM (${cur}). El usuario de servicio está fijo a ese período y puede NO devolver facturas de otros meses, así que el total podría estar incompleto.`
  }
  return null
}

export interface SalesSummary {
  range: { start: string; end: string }
  count: number
  total: number
  by_branch: Array<{ branch: string; count: number; total: number }>
  invoices: Invoice[]
}

// Resumen de ventas (facturas) por rango de invoice_date. Hace login, pagina y agrega.
export async function getSales(startMDY: string, endMDY: string): Promise<SalesSummary> {
  const jar = await suiteLogin()
  const invoices = await getInvoicesInRange(jar, startMDY, endMDY)

  const byBranch = new Map<string, { count: number; total: number }>()
  let total = 0
  for (const inv of invoices) {
    total += inv.total
    const key = inv.branch || '(sin sucursal)'
    const b = byBranch.get(key) ?? { count: 0, total: 0 }
    b.count++
    b.total += inv.total
    byBranch.set(key, b)
  }

  return {
    range: { start: startMDY, end: endMDY },
    count: invoices.length,
    total,
    by_branch: Array.from(byBranch, ([branch, v]) => ({ branch, ...v })).sort((a, b) => b.total - a.total),
    invoices,
  }
}
