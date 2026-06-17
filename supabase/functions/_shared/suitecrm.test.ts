// Tests de regresión de la auditoría C-A-R del feature "Inventarista CRM".
// Cada test mapea a un hallazgo confirmado. Importa SOLO suitecrm.ts (sin deps
// pesadas), así corre con `deno test --allow-env supabase/functions/_shared/suitecrm.test.ts`.
import {
  parseAmount,
  totalCount,
  mdyToNum,
  bogotaDate,
  salesRange,
  periodWarning,
  looksLikeLogin,
  isLoginFailureRedirect,
  parseInvoiceRows,
  cell,
  getInvoicesInRange,
} from './suitecrm.ts'

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error('FALLO: ' + msg)
}

// nowMs deterministas (Date.now no se usa: se inyecta).
const TUE_2026_06_16_12Z = Date.UTC(2026, 5, 16, 12, 0, 0) // martes 16-jun 12:00 UTC = 07:00 Bogota
const MON_2026_06_15_12Z = Date.UTC(2026, 5, 15, 12, 0, 0) // lunes 15-jun

// ── parseAmount: notas crédito / formato contable (accounting-negative-sign-flip) ──
Deno.test('parseAmount: monto normal, negativos contables y basura', () => {
  assert(parseAmount('$116,800.00') === 116800, 'positivo con coma de miles')
  assert(parseAmount(' $599,000.00 ') === 599000, 'con espacios')
  assert(parseAmount('($50.00)') === -50, 'paréntesis contable = negativo')
  assert(parseAmount('$-50.00') === -50, 'guion = negativo')
  assert(parseAmount('') === 0, 'vacío = 0')
  assert(parseAmount('N/A') === 0, 'no numérico = 0')
})

// ── totalCount: tolerancia de idioma (totalcount-locale-fragile-de-keyword) ──
Deno.test('totalCount: español "de", inglés "of" y ausencia', () => {
  assert(totalCount('algo (1 - 50 de 53) mas') === 53, 'español "de"')
  assert(totalCount('foo (1 - 50 of 53) bar') === 53, 'inglés "of"')
  assert(totalCount('(1 - 50 de 1,234)') === 1234, 'miles con coma')
  assert(totalCount('sin paginacion') === 0, 'sin match = 0')
})

// ── mdyToNum ──
Deno.test('mdyToNum: formato válido e inválido', () => {
  assert(mdyToNum('06/16/2026') === 20260616, 'MM/DD/YYYY')
  assert(mdyToNum('6/9/2026') === 20260609, 'sin ceros')
  assert(mdyToNum('2026-06-16') === null, 'ISO no es MM/DD/YYYY')
  assert(mdyToNum('') === null, 'vacío')
})

// ── bogotaDate: offset UTC-5 e inyección de tiempo (timestamp-bogota) ──
Deno.test('bogotaDate: UTC-5 y desplazamiento de días', () => {
  assert(bogotaDate(0, TUE_2026_06_16_12Z) === '06/16/2026', 'hoy')
  assert(bogotaDate(1, TUE_2026_06_16_12Z) === '06/15/2026', 'ayer')
  assert(bogotaDate(7, TUE_2026_06_16_12Z) === '06/09/2026', 'hace 7 días')
  // 03:00 UTC = 22:00 del día anterior en Bogota
  assert(bogotaDate(0, Date.UTC(2026, 5, 16, 3, 0, 0)) === '06/15/2026', 'cerca de medianoche Bogota')
})

// ── salesRange: last_7_days = 7 días (no 8) + last_week correcto (last7days-off-by-one) ──
Deno.test('salesRange: semántica de rangos', () => {
  const y = salesRange('yesterday', TUE_2026_06_16_12Z)
  assert(y.start === '06/15/2026' && y.end === '06/15/2026', 'yesterday = un solo día (ayer)')

  const t = salesRange('today', TUE_2026_06_16_12Z)
  assert(t.start === '06/16/2026' && t.end === '06/16/2026', 'today')

  const l7 = salesRange('last_7_days', TUE_2026_06_16_12Z)
  assert(l7.start === '06/09/2026' && l7.end === '06/15/2026', 'last_7_days termina AYER, no hoy')
  // exactamente 7 días inclusivos: 9,10,11,12,13,14,15
  const span = mdyToNum(l7.end)! - mdyToNum(l7.start)! + 1
  assert(span === 7, `last_7_days abarca 7 días (era 8), got ${span}`)

  // last_week = lunes..domingo de la semana pasada, para martes Y lunes
  const lwTue = salesRange('last_week', TUE_2026_06_16_12Z)
  assert(lwTue.start === '06/08/2026' && lwTue.end === '06/14/2026', 'last_week(martes) = 06/08..06/14')
  const lwMon = salesRange('last_week', MON_2026_06_15_12Z)
  assert(lwMon.start === '06/08/2026' && lwMon.end === '06/14/2026', 'last_week(lunes) = 06/08..06/14')
})

// ── periodWarning: rango fuera del período fijo (locked-period-cross-month-range) ──
Deno.test('periodWarning: detecta cruce de mes', () => {
  assert(periodWarning('06/01/2026', '06/16/2026', TUE_2026_06_16_12Z) === null, 'mismo mes → sin aviso')
  const w = periodWarning('05/31/2026', '06/01/2026', TUE_2026_06_16_12Z)
  assert(typeof w === 'string' && w.includes('fuera del período'), 'cruza mes → avisa')
  // El día 1: "yesterday" cae en el mes anterior
  const firstOfMonth = Date.UTC(2026, 6, 1, 12, 0, 0) // 1-jul
  const r = salesRange('yesterday', firstOfMonth) // 06/30/2026
  assert(periodWarning(r.start, r.end, firstOfMonth) !== null, 'ayer el día 1 = mes anterior → avisa')
})

// ── looksLikeLogin: distinguir login de list view (CRIT silent-$0) ──
Deno.test('looksLikeLogin: página de login vs autenticada', () => {
  assert(looksLikeLogin('<input name="username_password" type="password">') === true, 'form de login')
  assert(looksLikeLogin('<form action="index.php?action=Authenticate">') === true, 'action Authenticate')
  assert(looksLikeLogin('<table class="list view"><tr class="oddListRowS1">') === false, 'list view no es login')
})

// ── isLoginFailureRedirect: NO marcar éxito como fallo (regresión del falso positivo) ──
Deno.test('isLoginFailureRedirect: éxito (return_action=Login) NO es fallo', () => {
  // Redirect REAL de un login EXITOSO observado en el CRM:
  const ok = 'index.php?module=Users&action=DefinirPeriodo&auto=1&return_module=Users&return_action=Login&return_id='
  assert(isLoginFailureRedirect(ok) === false, 'éxito a DefinirPeriodo (con return_action=Login) NO es fallo')
  assert(isLoginFailureRedirect('index.php?module=Users&action=Login&login_error=1') === true, 'action=Login real = fallo')
  assert(isLoginFailureRedirect('') === false, 'sin location = no concluimos fallo')
})

// ── parseInvoiceRows: robustez de parseo ──
const ROW = (id: string, name: string, client: string, total: string, date: string, branch: string) => `
<tr height='20' class='oddListRowS1'>
  <td><input type="checkbox" name="mass[]" value="${id}"></td>
  <td><a class="edit-link" href="index.php?module=AOS_Invoices&action=EditView&record=${id}">edit</a></td>
  ${name ? `<td field="name"><a href="index.php?module=AOS_Invoices&action=DetailView&record=${id}">${name}</a></td>` : ''}
  <td field="billing_account"><a href="index.php?module=Accounts&action=DetailView&record=x">${client}</a></td>
  <td field="total_amount"> ${total}</td>
  <td field="invoice_date"> ${date}</td>
  <td field="sucursal_c"><a href="x">${branch}</a></td>
  <td field="date_entered"> ${date} 10:00</td>
</tr>`

Deno.test('parseInvoiceRows: fila normal', () => {
  const rows = parseInvoiceRows(ROW('ID1', 'RM10266', 'MEJIA CLAUDIA', '$116,800.00', '06/16/2026', 'Luthier'))
  assert(rows.length === 1, 'una fila')
  assert(rows[0].id === 'ID1' && rows[0].number === 'RM10266', 'id y número')
  assert(rows[0].total === 116800, 'total parseado')
  assert(rows[0].invoice_date === '06/16/2026' && rows[0].branch === 'Luthier', 'fecha y sucursal')
})

Deno.test('parseInvoiceRows: sin columna name pero con mass[] (row-filter-requires-name)', () => {
  const rows = parseInvoiceRows(ROW('IDX', '', 'Cliente', '$10.00', '06/16/2026', 'Luthier'))
  assert(rows.length === 1, 'la fila NO se descarta por faltar name')
  assert(rows[0].id === 'IDX' && rows[0].total === 10, 'parsea id y total igual')
})

Deno.test('parseInvoiceRows: tabla anidada NO trunca la fila (nested-tr-truncates-row)', () => {
  // Menú de acciones con su propia <tr> ANTES de total_amount.
  const nested = `
<tr height='20' class='oddListRowS1'>
  <td><input type="checkbox" name="mass[]" value="IDN"></td>
  <td><div class="actionmenu"><table><tr><td>Editar</td></tr><tr><td>Borrar</td></tr></table></div></td>
  <td field="name"><a href="index.php?action=DetailView&record=IDN">RM9</a></td>
  <td field="total_amount"> $777,000.00</td>
  <td field="invoice_date"> 06/16/2026</td>
  <td field="sucursal_c">Luthier</td>
</tr>`
  const rows = parseInvoiceRows(nested)
  assert(rows.length === 1, 'una fila pese a la tabla anidada')
  assert(rows[0].total === 777000, `total NO truncado a 0 (got ${rows[0].total})`)
  assert(rows[0].invoice_date === '06/16/2026', 'fecha tras la tabla anidada sí se lee')
})

Deno.test('cell: decodifica entidades y acota como dato', () => {
  const seg = `<td field="billing_account">Pepe &amp; Co. &lt;x&gt;</td>`
  assert(cell(seg, 'billing_account') === 'Pepe & Co. <x>', 'decodifica &amp; &lt; &gt;')
})

// ── getInvoicesInRange: detección de fallo de sesión + filtro local (CRIT) ──
function withMockFetch(handler: (url: string) => Response, fn: () => Promise<void>) {
  const orig = globalThis.fetch
  // deno-lint-ignore no-explicit-any
  globalThis.fetch = ((input: any) => Promise.resolve(handler(String(input)))) as typeof fetch
  return fn().finally(() => { globalThis.fetch = orig })
}

Deno.test('getInvoicesInRange: página de login → LANZA (no "0 ventas")', async () => {
  Deno.env.set('SUITECRM_USER', 'u'); Deno.env.set('SUITECRM_PASS', 'p')
  let threw = false
  await withMockFetch(
    () => new Response('<input name="username_password">', { status: 200 }),
    async () => {
      try { await getInvoicesInRange(new Map([['PHPSESSID', 'x']]), '06/16/2026', '06/16/2026') }
      catch { threw = true }
    },
  )
  assert(threw, 'una página de login al leer debe lanzar, no devolver []')
})

Deno.test('getInvoicesInRange: redirect 3xx → LANZA', async () => {
  Deno.env.set('SUITECRM_USER', 'u'); Deno.env.set('SUITECRM_PASS', 'p')
  let threw = false
  await withMockFetch(
    () => new Response('', { status: 302, headers: { location: 'index.php?action=DefinirPeriodo' } }),
    async () => {
      try { await getInvoicesInRange(new Map([['PHPSESSID', 'x']]), '06/16/2026', '06/16/2026') }
      catch { threw = true }
    },
  )
  assert(threw, 'un 3xx al leer debe lanzar')
})

Deno.test('getInvoicesInRange: filtro local descarta fuera de rango (between-no-range-validation)', async () => {
  Deno.env.set('SUITECRM_USER', 'u'); Deno.env.set('SUITECRM_PASS', 'p')
  const html = '<table>' +
    ROW('A', 'RM1', 'C1', '$100.00', '06/16/2026', 'Luthier') +
    ROW('B', 'RM2', 'C2', '$200.00', '06/16/2026', 'Luthier') +
    ROW('C', 'RM3', 'C3', '$999.00', '06/20/2026', 'Luthier') + // fuera de rango
    '<div>(1 - 3 de 3)</div></table>'
  let result: Awaited<ReturnType<typeof getInvoicesInRange>> = []
  await withMockFetch(
    () => new Response(html, { status: 200 }),
    async () => { result = await getInvoicesInRange(new Map([['PHPSESSID', 'x']]), '06/16/2026', '06/16/2026') },
  )
  assert(result.length === 2, `solo las 2 en rango (got ${result.length})`)
  assert(result.every((r) => r.invoice_date === '06/16/2026'), 'descarta 06/20/2026')
})
