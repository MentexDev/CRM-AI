#!/usr/bin/env node
// Harness de Evals del CRM — corre una batería de casos contra el runtime DESPLEGADO
// y verifica el comportamiento de cada agente. Dos tipos de caso:
//   - kind:'chat' (default): llama chat-with-agent (usuario presente) y revisa
//     herramientas usadas / artefactos / respuesta.
//   - kind:'autonomous': crea una tarea, invoca run-agent-step (modo cron) y revisa
//     el efecto (p.ej. que send_email cree una aprobación y NO envíe).
// Reemplaza el "probar a mano" de cada C-A-R por algo repetible.
//
// Por qué e2e contra el entorno real: no hay stack Deno local (Deno no está instalado),
// así que estos evals validan el runtime tal cual corre. Crean conversaciones/tareas
// EFÍMERAS y las BORRAN al final (usa --no-cleanup para conservarlas y depurar un fallo).
//
// Uso:
//   node evals/run.mjs                 # corre todos los casos
//   node evals/run.mjs creador         # solo casos cuyo nombre/agente contenga "creador"
//   node evals/run.mjs --no-cleanup    # no borra lo que creó
//
// Credenciales (en este orden):
//   1) env SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY (ideal para CI), o
//   2) se obtienen vía Management API con SUPABASE_ACCESS_TOKEN o ~/.supabase/access-token.
// Usuario de prueba: env EVAL_USER_EMAIL (default: el de pruebas, que es 'junta' → puede
// invocar run-agent-step). Proyecto: env SUPABASE_PROJECT_REF.

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { CASES } from './cases.mjs'

const REF = process.env.SUPABASE_PROJECT_REF || 'ccaufudzkgvrdxwmazwk'
const BASE = `https://${REF}.supabase.co`
const EVAL_EMAIL = process.env.EVAL_USER_EMAIL || 'alexismendozacarmona@gmail.com'

const args = process.argv.slice(2)
const cleanup = !args.includes('--no-cleanup')
const filter = args.find((a) => !a.startsWith('--'))

async function getKeys() {
  if (process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { anon: process.env.SUPABASE_ANON_KEY, service: process.env.SUPABASE_SERVICE_ROLE_KEY }
  }
  let token = process.env.SUPABASE_ACCESS_TOKEN
  if (!token) {
    try { token = readFileSync(`${homedir()}/.supabase/access-token`, 'utf8').trim() } catch { /* sin archivo */ }
  }
  if (!token) throw new Error('Sin credenciales: define SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY, o SUPABASE_ACCESS_TOKEN.')
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`, {
    headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'curl/8.0' },
  })
  if (!res.ok) throw new Error(`No pude leer api-keys de la Management API (${res.status}).`)
  const keys = await res.json()
  return {
    anon: keys.find((k) => k.name === 'anon')?.api_key,
    service: keys.find((k) => k.name === 'service_role')?.api_key,
  }
}

// JWT del usuario de prueba sin supabase-js (Node 20 no trae WebSocket): magiclink → verify.
async function getJwt(anon, service) {
  const gl = await (await fetch(`${BASE}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email: EVAL_EMAIL }),
  })).json()
  const hashed = gl.hashed_token || gl.properties?.hashed_token
  if (!hashed) throw new Error(`No pude generar el magiclink para ${EVAL_EMAIL}.`)
  const v = await (await fetch(`${BASE}/auth/v1/verify`, {
    method: 'POST',
    headers: { apikey: anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', token_hash: hashed }),
  })).json()
  if (!v.access_token) throw new Error('No pude verificar el magiclink (sin access_token).')
  return { jwt: v.access_token, userId: v.user?.id ?? null }
}

async function resolveAgent(slug, ctx) {
  const a = await (await fetch(`${BASE}/rest/v1/agents?slug=eq.${slug}&select=id,brand_id`, { headers: ctx.svc })).json()
  return Array.isArray(a) ? a[0] : null
}

// --- CHAT: un turno usuario↔agente, arma el transcript de lo que el agente hizo. ---
async function runChat(c, ctx) {
  const body = { agent_slug: c.agent, content: c.message }
  if (c.force_tool) body.force_tool = c.force_tool
  let status = 0
  let error = null
  let resp = null
  try {
    const r = await fetch(`${BASE}/functions/v1/chat-with-agent`, { method: 'POST', headers: ctx.uhdr, body: JSON.stringify(body) })
    status = r.status
    resp = await r.json()
    if (resp?.error) error = resp.error
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }
  const conv = resp?.conversation_id || null
  let messages = []
  if (conv) {
    const m = await (await fetch(`${BASE}/rest/v1/messages?conversation_id=eq.${conv}&select=role,content,tool_calls&order=created_at.asc`, { headers: ctx.svc })).json()
    if (Array.isArray(m)) messages = m
  }
  const calledTools = []
  const artifacts = []
  for (const m of messages) {
    if (Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls) {
        const n = tc?.function?.name
        if (n) calledTools.push(n)
      }
    }
    if (m.role === 'tool' && typeof m.content === 'string') {
      try { const k = JSON.parse(m.content)?.data?.kind; if (k) artifacts.push(k) } catch { /* no-json */ }
    }
  }
  const reply = [...messages].reverse().find((m) => m.role === 'assistant' && typeof m.content === 'string' && m.content.trim())?.content || ''
  if (conv) ctx.cleanups.push(async () => {
    await fetch(`${BASE}/rest/v1/messages?conversation_id=eq.${conv}`, { method: 'DELETE', headers: ctx.svc })
    await fetch(`${BASE}/rest/v1/conversations?id=eq.${conv}`, { method: 'DELETE', headers: ctx.svc })
  })
  return { status, error, reply, calledTools, artifacts }
}

// --- AUTÓNOMO: crea una tarea, invoca run-agent-step y revisa el efecto (approvals/task). ---
async function runAutonomous(c, ctx) {
  const agent = await resolveAgent(c.agent, ctx)
  if (!agent) return { status: 0, error: `agente no encontrado: ${c.agent}`, approvals: [], taskStatus: null }
  // 1) crear la tarea (to_do → runAgentStep la toma)
  const created = await (await fetch(`${BASE}/rest/v1/tasks`, {
    method: 'POST',
    headers: { ...ctx.svc, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ agent_id: agent.id, brand_id: agent.brand_id ?? null, title: c.taskTitle || `Eval: ${c.name}`, description: c.message, status: 'to_do', priority: 1, created_by: ctx.userId }),
  })).json()
  const task = Array.isArray(created) ? created[0] : null
  if (!task?.id) return { status: 0, error: `no pude crear la tarea: ${JSON.stringify(created).slice(0, 120)}`, approvals: [], taskStatus: null }
  ctx.cleanups.push(async () => {
    await fetch(`${BASE}/rest/v1/messages?task_id=eq.${task.id}`, { method: 'DELETE', headers: ctx.svc })
    await fetch(`${BASE}/rest/v1/approvals?task_id=eq.${task.id}`, { method: 'DELETE', headers: ctx.svc })
    await fetch(`${BASE}/rest/v1/tasks?id=eq.${task.id}`, { method: 'DELETE', headers: ctx.svc })
  })
  // 2) invocar run-agent-step (JWT del usuario junta)
  let status = 0
  let error = null
  let reason = null
  try {
    const r = await fetch(`${BASE}/functions/v1/run-agent-step`, { method: 'POST', headers: ctx.uhdr, body: JSON.stringify({ agent_id: agent.id }) })
    status = r.status
    const j = await r.json()
    if (j?.error) error = j.error
    reason = j?.reason ?? null
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }
  // 3) leer el efecto: approvals de esta tarea + estado final de la tarea
  const ap = await (await fetch(`${BASE}/rest/v1/approvals?task_id=eq.${task.id}&select=trigger,status`, { headers: ctx.svc })).json()
  const tr = await (await fetch(`${BASE}/rest/v1/tasks?id=eq.${task.id}&select=status`, { headers: ctx.svc })).json()
  return { status, error, reason, approvals: Array.isArray(ap) ? ap : [], taskStatus: Array.isArray(tr) ? tr[0]?.status : null }
}

function fmt(t) {
  if (t.approvals !== undefined) {
    return `status=${t.status} approvals=[${t.approvals.map((a) => `${a.trigger}:${a.status}`).join(',')}] task=${t.taskStatus} reason=${t.reason}`
  }
  return `status=${t.status} tools=[${t.calledTools.join(',')}] artifacts=[${t.artifacts.join(',')}] reply="${t.reply.slice(0, 60).replace(/\n/g, ' ')}"`
}

async function main() {
  const { anon, service } = await getKeys()
  if (!anon || !service) throw new Error('Faltan las llaves anon/service.')
  const { jwt, userId } = await getJwt(anon, service)
  const ctx = {
    userId,
    uhdr: { apikey: anon, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    svc: { apikey: service, Authorization: `Bearer ${service}` },
    cleanups: [],
  }

  const selected = CASES.filter((c) => !filter || c.name.includes(filter) || c.agent.includes(filter))
  console.log(`\n🧪 Evals CRM · ${selected.length} caso(s) · proyecto ${REF}\n`)

  let passed = 0
  let failed = 0
  for (const c of selected) {
    const t = c.kind === 'autonomous' ? await runAutonomous(c, ctx) : await runChat(c, ctx)
    const results = c.expect.map((a) => ({ label: a.label, pass: !!a.check(t) }))
    const ok = results.every((r) => r.pass)
    console.log(`${ok ? '✅' : '❌'} ${c.name}${c.kind === 'autonomous' ? ' (autónomo)' : ''}`)
    if (!ok) {
      for (const r of results) console.log(`     ${r.pass ? '·' : '✗'} ${r.label}`)
      console.log(`     ⤷ ${fmt(t)}${t.error ? '  ERROR=' + t.error : ''}`)
    }
    ok ? passed++ : failed++
  }

  // Limpieza: deshacer todo lo efímero que se creó (conversaciones, tareas, approvals, mensajes).
  if (cleanup && ctx.cleanups.length) {
    for (const fn of ctx.cleanups) { try { await fn() } catch { /* best-effort */ } }
    console.log(`\n🧹 Limpieza: ${ctx.cleanups.length} artefacto(s) efímero(s) borrado(s).`)
  } else if (ctx.cleanups.length) {
    console.log(`\n(--no-cleanup) ${ctx.cleanups.length} artefacto(s) conservado(s).`)
  }

  console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed}/${selected.length} pasaron${failed ? `, ${failed} fallaron` : ''}.\n`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => { console.error('💥', e.message); process.exit(2) })
