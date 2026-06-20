#!/usr/bin/env node
// Harness de Evals del CRM — corre una batería de casos contra el runtime DESPLEGADO
// (la Edge Function chat-with-agent) y verifica el comportamiento de cada agente:
// que responda, que elija la herramienta correcta, que produzca el artefacto esperado
// y los guardrails. Reemplaza el "probar a mano" de cada C-A-R por algo repetible.
//
// Por qué e2e contra el entorno real: no hay stack Deno local (Deno no está instalado),
// así que estos evals validan el runtime tal cual corre. Crean conversaciones EFÍMERAS
// y las BORRAN al final (usa --no-cleanup para conservarlas y depurar un fallo).
//
// Uso:
//   node evals/run.mjs                 # corre todos los casos
//   node evals/run.mjs creador         # solo casos cuyo nombre/agente contenga "creador"
//   node evals/run.mjs --no-cleanup    # no borra las conversaciones creadas
//
// Credenciales (en este orden):
//   1) env SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY (ideal para CI), o
//   2) se obtienen vía Management API con SUPABASE_ACCESS_TOKEN o ~/.supabase/access-token.
// Usuario de prueba: env EVAL_USER_EMAIL (default: el usuario de pruebas conocido).
// Proyecto: env SUPABASE_PROJECT_REF (default: el de producción).

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
  return v.access_token
}

// Corre un turno y arma el "transcript": qué herramientas llamó, qué artefactos produjo, qué respondió.
async function runTurn(c, ctx) {
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
  const toolResults = []
  for (const m of messages) {
    if (Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls) {
        const n = tc?.function?.name
        if (n) calledTools.push(n)
      }
    }
    if (m.role === 'tool' && typeof m.content === 'string') {
      try {
        const parsed = JSON.parse(m.content)
        toolResults.push(parsed)
        if (parsed?.data?.kind) artifacts.push(parsed.data.kind)
      } catch { /* resultado de tool no-JSON */ }
    }
  }
  const reply = [...messages].reverse().find((m) => m.role === 'assistant' && typeof m.content === 'string' && m.content.trim())?.content || ''
  return { status, error, reply, calledTools, artifacts, toolResults, conv }
}

function fmt(t) {
  return `status=${t.status} tools=[${t.calledTools.join(',')}] artifacts=[${t.artifacts.join(',')}] reply="${t.reply.slice(0, 60).replace(/\n/g, ' ')}"`
}

async function main() {
  const { anon, service } = await getKeys()
  if (!anon || !service) throw new Error('Faltan las llaves anon/service.')
  const jwt = await getJwt(anon, service)
  const ctx = {
    uhdr: { apikey: anon, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    svc: { apikey: service, Authorization: `Bearer ${service}` },
  }

  const selected = CASES.filter((c) => !filter || c.name.includes(filter) || c.agent.includes(filter))
  console.log(`\n🧪 Evals CRM · ${selected.length} caso(s) · proyecto ${REF}\n`)

  const createdConvs = []
  let passed = 0
  let failed = 0
  for (const c of selected) {
    const t = await runTurn(c, ctx)
    if (t.conv) createdConvs.push(t.conv)
    const results = c.expect.map((a) => ({ label: a.label, pass: !!a.check(t) }))
    const ok = results.every((r) => r.pass)
    console.log(`${ok ? '✅' : '❌'} ${c.name}`)
    if (!ok) {
      for (const r of results) console.log(`     ${r.pass ? '·' : '✗'} ${r.label}`)
      console.log(`     ⤷ ${fmt(t)}${t.error ? '  ERROR=' + t.error : ''}`)
    }
    ok ? passed++ : failed++
  }

  // Limpieza: borrar las conversaciones efímeras que creó la corrida (mensajes primero por la FK).
  if (cleanup && createdConvs.length) {
    for (const id of createdConvs) {
      await fetch(`${BASE}/rest/v1/messages?conversation_id=eq.${id}`, { method: 'DELETE', headers: ctx.svc })
      await fetch(`${BASE}/rest/v1/conversations?id=eq.${id}`, { method: 'DELETE', headers: ctx.svc })
    }
    console.log(`\n🧹 Limpieza: ${createdConvs.length} conversación(es) efímera(s) borrada(s).`)
  } else if (createdConvs.length) {
    console.log(`\n(--no-cleanup) ${createdConvs.length} conversación(es) conservada(s).`)
  }

  console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed}/${selected.length} pasaron${failed ? `, ${failed} fallaron` : ''}.\n`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => { console.error('💥', e.message); process.exit(2) })
