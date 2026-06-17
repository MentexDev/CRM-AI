// Helpers puros del drawer de tareas (Fase A, estilo NeuralOS). Extraídos de Tasks.jsx
// para poder testearlos: `deno test src/lib/taskDrawer.test.js`.

export const STATUS_PROGRESS = { to_do: 5, in_progress: 50, blocked: 40, needs_review: 85, done: 100 }

// Estimación blended sólo para mostrar ~$ junto a los tokens (el dato real son los tokens).
const COST_PER_MILLION_USD = 0.6

const BRIEF_LABELS = [
  { key: 'Objetivo', re: /Objetivo\s*:/i },
  { key: 'Contexto', re: /Contexto\s*:/i },
  { key: 'Criterio de éxito', re: /Criterio de [eé]xito\s*:/i },
]

// Parte la descripción (formato de delegate_task) en secciones. Asume un único label por
// tipo y al inicio de su sección (formato actual). Conserva el preámbulo (texto antes del
// primer label), cae a texto crudo si los valores quedan vacíos, y ordena las secciones en
// el orden canónico Objetivo→Contexto→Criterio sin importar el orden del texto.
export function parseTaskBrief(description) {
  const raw = (description || '').trim()
  if (!raw) return { preamble: '', sections: [], raw: '' }

  const found = []
  for (let li = 0; li < BRIEF_LABELS.length; li++) {
    const m = raw.match(BRIEF_LABELS[li].re)
    if (m) found.push({ key: BRIEF_LABELS[li].key, order: li, start: m.index, contentStart: m.index + m[0].length })
  }
  if (found.length === 0) return { preamble: '', sections: [], raw }

  const byPos = found.slice().sort((a, b) => a.start - b.start)
  const preamble = byPos[0].start > 0 ? raw.slice(0, byPos[0].start).trim() : ''
  const sections = byPos
    .map((f, i) => ({
      key: f.key,
      order: f.order,
      value: raw.slice(f.contentStart, i + 1 < byPos.length ? byPos[i + 1].start : raw.length).trim(),
    }))
    .filter((s) => s.value)
    .sort((a, b) => a.order - b.order)
    .map(({ key, value }) => ({ key, value }))

  // Había labels pero todos los valores quedaron vacíos → no perder el texto, mostrarlo crudo.
  if (sections.length === 0) return { preamble: '', sections: [], raw }
  return { preamble, sections, raw: '' }
}

export function sumTokens(messages) {
  let t = 0
  for (const m of messages || []) {
    const v = m?.metadata?.usage?.total_tokens
    if (v != null) t += Number(v) || 0
  }
  return t
}

export function fmtDuration(ms) {
  if (ms == null || Number.isNaN(ms) || ms < 0) return '—'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}min`
  const h = m / 60
  if (h < 24) return `${h.toFixed(1)}h`
  return `${(h / 24).toFixed(1)}d`
}

// Costo estimado para `tokens`. Devuelve '<$0.01' en sub-céntimos (evita el engañoso
// '$0.00' de toda tarea chica) y null si no hay tokens.
export function estimateCost(tokens) {
  if (!tokens || tokens <= 0) return null
  const usd = (tokens / 1_000_000) * COST_PER_MILLION_USD
  return usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`
}

const truncate = (s, n = 280) => {
  const str = String(s || '').trim()
  return str.length > n ? str.slice(0, n) + '…' : str
}

// Eventos del timeline a partir de los mensajes de la tarea (+ estado final). Cada evento
// trae una `key` estable para React (no índices).
export function buildTimeline(messages, task, agentName) {
  const ev = [
    { key: 'created', kind: 'created', title: 'Tarea creada', detail: agentName ? `Asignada a ${agentName}` : null, at: task.created_at },
  ]
  for (const m of messages || []) {
    if (m.role === 'user') {
      // Inyección autónoma de la tarea ("[Tarea <id>] …"): ya representada por "Tarea creada".
      if (/^\[Tarea\s/i.test(String(m.content || ''))) continue
      ev.push({ key: `u-${m.id}`, kind: 'instruction', title: 'Instrucción', detail: truncate(m.content), at: m.created_at })
    } else if (m.role === 'assistant') {
      if (m.content && String(m.content).trim()) {
        ev.push({ key: `a-${m.id}`, kind: 'reasoning', title: 'Razonamiento', detail: truncate(m.content), at: m.created_at })
      }
      const calls = Array.isArray(m.tool_calls) ? m.tool_calls : []
      calls.forEach((c, ci) => {
        ev.push({ key: `t-${m.id}-${ci}`, kind: 'tool', title: 'Herramienta', detail: c?.function?.name || c?.name || 'herramienta', at: m.created_at })
      })
    } else if (m.role === 'tool') {
      let ok = true
      try { ok = JSON.parse(m.content)?.ok !== false } catch { /* contenido no-JSON */ }
      ev.push({ key: `r-${m.id}`, kind: 'result', title: 'Resultado', detail: ok ? 'ok' : 'error', at: m.created_at, ok })
    }
  }
  if (task.status === 'done') {
    ev.push({ key: 'done', kind: 'done', title: 'Completada', detail: truncate(task.result?.summary), at: task.updated_at })
  } else if (task.status === 'blocked') {
    ev.push({ key: 'blocked', kind: 'blocked', title: 'Bloqueada', detail: 'Esperando aprobación o subordinados', at: task.updated_at })
  }
  return ev
}
