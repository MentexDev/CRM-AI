// Tests de regresión de la auditoría C-A-R del drawer de tareas (Fase A).
// Correr: deno test src/lib/taskDrawer.test.js
import { parseTaskBrief, sumTokens, fmtDuration, estimateCost, buildTimeline } from './taskDrawer.js'

function assert(cond, msg) {
  if (!cond) throw new Error('FALLO: ' + msg)
}

// ── parseTaskBrief ──
Deno.test('parseTaskBrief: formato normal', () => {
  const r = parseTaskBrief('Objetivo: Vender más.\n\nContexto: Q3.\n\nCriterio de éxito: +10%.')
  assert(r.sections.length === 3, '3 secciones')
  assert(r.sections[0].key === 'Objetivo' && r.sections[0].value === 'Vender más.', 'objetivo')
  assert(r.sections[2].key === 'Criterio de éxito' && r.sections[2].value === '+10%.', 'criterio')
  assert(r.preamble === '' && r.raw === '', 'sin preámbulo ni raw')
})

Deno.test('parseTaskBrief: conserva el preámbulo (DL-1)', () => {
  const r = parseTaskBrief('Hola equipo, esto es urgente. Objetivo: arreglar.')
  assert(r.preamble === 'Hola equipo, esto es urgente.', `preámbulo conservado, got "${r.preamble}"`)
  assert(r.sections.length === 1 && r.sections[0].value === 'arreglar.', 'objetivo')
})

Deno.test('parseTaskBrief: labels con valores vacíos → texto crudo (DL-2)', () => {
  const r = parseTaskBrief('Objetivo:')
  assert(r.sections.length === 0 && r.raw === 'Objetivo:', 'cae a raw, no descarta')
})

Deno.test('parseTaskBrief: orden canónico aunque el texto venga invertido (DL-3)', () => {
  const r = parseTaskBrief('Criterio de éxito: que funcione. Objetivo: arreglar. Contexto: prod.')
  assert(r.sections.map((s) => s.key).join('|') === 'Objetivo|Contexto|Criterio de éxito', 'orden canónico')
})

Deno.test('parseTaskBrief: texto libre sin labels → raw', () => {
  const r = parseTaskBrief('Solo una nota suelta.')
  assert(r.sections.length === 0 && r.raw === 'Solo una nota suelta.', 'raw')
  assert(parseTaskBrief('').raw === '' && parseTaskBrief(null).sections.length === 0, 'vacío/null seguro')
})

// ── fmtDuration (DL-6) ──
Deno.test('fmtDuration: límites', () => {
  assert(fmtDuration(0) === '0s', '0ms = 0s (no "—")')
  assert(fmtDuration(-5) === '—', 'negativo')
  assert(fmtDuration(null) === '—' && fmtDuration(NaN) === '—', 'null/NaN')
  assert(fmtDuration(45000) === '45s', 'segundos')
  assert(fmtDuration(120000) === '2min', 'minutos')
  assert(fmtDuration(3600000) === '1.0h', 'horas')
  assert(fmtDuration(172800000) === '2.0d', 'días (antes faltaba)')
})

// ── estimateCost (DL-5/UX-02) ──
Deno.test('estimateCost: sub-céntimo no muestra $0.00', () => {
  assert(estimateCost(5407) === '<$0.01', `tarea chica = <$0.01, got ${estimateCost(5407)}`)
  assert(estimateCost(0) === null && estimateCost(undefined) === null, 'sin tokens = null')
  assert(estimateCost(5_000_000) === '$3.00', 'tarea grande = $X.XX')
})

// ── sumTokens ──
Deno.test('sumTokens: suma usage.total_tokens, ignora faltantes', () => {
  const msgs = [
    { metadata: { usage: { total_tokens: 2237 } } },
    { metadata: {} },
    { metadata: { usage: { total_tokens: 3170 } } },
    {},
  ]
  assert(sumTokens(msgs) === 5407, `5407, got ${sumTokens(msgs)}`)
  assert(sumTokens(null) === 0, 'null seguro')
})

// ── buildTimeline ──
const TASK = { created_at: '2026-06-17T20:00:00Z', updated_at: '2026-06-17T21:00:00Z', status: 'done', result: { summary: 'Listo.' } }
Deno.test('buildTimeline: mapea pasos y omite la inyección de tarea', () => {
  const msgs = [
    { id: 1, role: 'user', content: '[Tarea abc] hacer X', created_at: 'a' },
    { id: 2, role: 'assistant', content: null, tool_calls: [{ function: { name: 'suitecrm_sales' } }], created_at: 'b' },
    { id: 3, role: 'tool', content: '{"ok":true}', created_at: 'c' },
  ]
  const ev = buildTimeline(msgs, TASK, 'Inventarista CRM')
  const kinds = ev.map((e) => e.kind).join('|')
  assert(kinds === 'created|tool|result|done', `secuencia, got ${kinds}`)
  assert(!ev.some((e) => e.title === 'Instrucción'), 'omite la inyección [Tarea …]')
  assert(ev[1].detail === 'suitecrm_sales', 'nombre de herramienta')
  assert(ev[2].ok === true, 'resultado ok')
  assert(new Set(ev.map((e) => e.key)).size === ev.length, 'keys estables y únicas')
})

Deno.test('buildTimeline: robusto ante tool_calls no-array y tool no-JSON', () => {
  const msgs = [
    { id: 1, role: 'assistant', content: 'Pienso esto', tool_calls: 'no-array', created_at: 'a' },
    { id: 2, role: 'tool', content: 'texto no json', created_at: 'b' },
  ]
  const ev = buildTimeline(msgs, { ...TASK, status: 'in_progress' }, 'X')
  assert(ev.some((e) => e.kind === 'reasoning' && e.detail === 'Pienso esto'), 'razonamiento con content')
  assert(ev.some((e) => e.kind === 'result' && e.ok === true), 'tool no-JSON → ok por defecto')
  assert(!ev.some((e) => e.kind === 'done'), 'in_progress no agrega "completada"')
})
