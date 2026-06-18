// Suite de regresión del MOTOR (F5 · evals nivel-unidad).
// Corre con: deno test --node-modules-dir=none --allow-net --allow-env supabase/functions/_shared/engine.test.ts
// Cubre los invariantes que ya nos atraparon bugs reales en las auditorías C-A-R:
// el cap estructural produce JSON válido, el detector de límite, y el ToolRegistry
// (carga sin drift). NO son evals de comportamiento del LLM (eso es una iniciativa
// aparte: golden tasks + judge); son guardas de regresión del código del motor.
import { capToolContentString, capToolResultForContext, dailyBudgetExceeded, dropOrphanToolMessages, toolRegistry } from './tools.ts'
import { isRateOrSizeLimitError } from './llm.ts'

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error('FALLO: ' + msg)
}

const bigOrders = {
  ok: true,
  data: {
    orders: Array.from({ length: 40 }, (_, i) => ({
      id: 1000 + i, name: `#NINA${i}`, total: 191900, subtotal: 179900, shipping: 12000, currency: 'COP',
      customer_name: 'Ana Velasquez Rodriguez NINA '.repeat(3),
      customer_email: `cliente.numero.${i}.larguisimo@gmail.com`,
      items: [{ title: 'JEAN WIDE LEG CARGO DEGRADE DREAM '.repeat(2), quantity: 1, sku: `NINA-${20000 + i}` }],
    })),
    count: 40,
  },
}

Deno.test('cap: payload chico pasa intacto y válido', () => {
  const small = { ok: true, data: { x: 1 } }
  assert(capToolResultForContext(small) === JSON.stringify(small), 'chico intacto')
})

Deno.test('cap: resultado grande → JSON VÁLIDO (regresión "Tool falló")', () => {
  const capped = capToolResultForContext(bigOrders)
  assert(capped.length <= 5200, `bajo el límite (${capped.length})`)
  const parsed = JSON.parse(capped) // no debe lanzar
  assert(parsed.ok === true, 'conserva ok:true (la UI no muestra "Tool falló")')
})

Deno.test('cap: truncado ESTRUCTURAL (recorta items, conserva count)', () => {
  const p = JSON.parse(capToolResultForContext(bigOrders))
  assert(Array.isArray(p.data.orders) && p.data.orders.length < 40, 'recorta el array')
  assert(p.data._truncated_items > 0, 'anota _truncated_items')
  assert(p.data.count === 40, 'conserva count=40 (el modelo sabe el total real)')
})

Deno.test('capToolContentString: historial grande sigue siendo JSON válido', () => {
  const cs = capToolContentString(JSON.stringify(bigOrders))
  JSON.parse(cs) // no debe lanzar
  assert(capToolContentString('{"ok":true}') === '{"ok":true}', 'string chico intacto')
  assert(capToolContentString('no-json {roto'.repeat(500)).includes('recortado'), 'no-JSON → marcador, sin lanzar')
})

Deno.test('isRateOrSizeLimitError: detecta límites, no errores normales', () => {
  assert(isRateOrSizeLimitError({ status: 413, message: 'Request too large ... TPM' }), 'Groq 413')
  assert(isRateOrSizeLimitError({ status: 429, message: 'rate limit' }), '429')
  assert(isRateOrSizeLimitError({ status: 400, message: '400 prompt is too long: 250000 tokens' }), 'Anthropic 400')
  assert(!isRateOrSizeLimitError({ status: 400, message: 'invalid api key' }), 'NO marca 400 normal')
  assert(!isRateOrSizeLimitError(new Error('network timeout')), 'NO marca error de red')
})

Deno.test('F5 dailyBudgetExceeded: tope por agente (default 3M, configurable)', () => {
  assert(dailyBudgetExceeded(3_000_000, null) === true, 'iguala el default → excedido')
  assert(dailyBudgetExceeded(2_999_999, null) === false, 'bajo el default → ok')
  assert(dailyBudgetExceeded(0, null) === false, '0 → ok')
  assert(dailyBudgetExceeded('500', { daily_token_budget: 400 }) === true, 'spent string + budget configurado')
  assert(dailyBudgetExceeded(100, { daily_token_budget: 50 }) === true, 'budget custom excedido')
  assert(dailyBudgetExceeded(null, null) === false, 'null → 0 → ok (el error de RPC lo gestiona el caller, fail-closed)')
})

Deno.test('toolRegistry: carga sin drift y con las tools clave', () => {
  // Si hubiera drift (spec sin handler o al revés), el constructor del registry
  // habría lanzado AL IMPORTAR este módulo — llegar aquí ya es media prueba.
  const all = toolRegistry.all()
  assert(all.length >= 20, `>= 20 tools (hay ${all.length})`)
  for (const name of ['send_email', 'compose_email', 'delegate_task', 'finish_task', 'query_brain']) {
    assert(!!toolRegistry.get(name), `existe la tool ${name}`)
  }
  // definitions(allowed) filtra por allowed_tools
  const defs = toolRegistry.definitions(['web_search'])
  assert(defs.length === 1 && defs[0].function.name === 'web_search', 'definitions filtra por allowed')
})

Deno.test('dropOrphanToolMessages: descarta tool huérfano al cortar la ventana (regresión 400)', () => {
  // Ventana que arranca a mitad de un turno: el primer 'tool' perdió su assistant.
  const cut = [
    { role: 'tool', tool_call_id: 'huerfano', tool_calls: null }, // su assistant quedó FUERA
    { role: 'assistant', tool_call_id: null, tool_calls: [{ id: 'c1', function: { name: 'x' } }] },
    { role: 'tool', tool_call_id: 'c1', tool_calls: null }, // este SÍ tiene su assistant en la ventana
    { role: 'assistant', tool_call_id: null, tool_calls: null },
  ]
  const clean = dropOrphanToolMessages(cut)
  assert(clean.length === 3, `quita 1 huérfano (quedaron ${clean.length})`)
  assert(!clean.some((m) => m.role === 'tool' && m.tool_call_id === 'huerfano'), 'el huérfano se fue')
  assert(clean.some((m) => m.role === 'tool' && m.tool_call_id === 'c1'), 'el tool con su assistant se queda')
})

Deno.test('dropOrphanToolMessages: turno completo intacto; user/assistant nunca se tocan', () => {
  const full = [
    { role: 'user', tool_call_id: null, tool_calls: null },
    { role: 'assistant', tool_call_id: null, tool_calls: [{ id: 'a1' }, { id: 'a2' }] },
    { role: 'tool', tool_call_id: 'a1', tool_calls: null },
    { role: 'tool', tool_call_id: 'a2', tool_calls: null },
    { role: 'assistant', tool_call_id: null, tool_calls: null },
  ]
  assert(dropOrphanToolMessages(full).length === 5, 'turno completo no se toca')
  assert(dropOrphanToolMessages([{ role: 'tool', tool_call_id: 'x', tool_calls: null }]).length === 0, 'tool solo → fuera')
})
