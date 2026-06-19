// Edge Function · import-skills
//
// Importa SKILLS (playbooks de conocimiento en Markdown) desde un repositorio PÚBLICO de GitHub.
// Busca archivos SKILL.md (convención de Agent Skills); si no hay, toma los .md del repo. Parsea
// frontmatter (name/description), guarda en `skills` con la marca del agente y las ASIGNA al agente.
//
// Body: { repo: string (URL o "owner/repo"), agent_id: string, branch?: string, path?: string }
// Auth: JWT del caller; debe poder LEER el agente (RLS) → aislamiento por marca.
import { createClient } from 'jsr:@supabase/supabase-js@^2'
import { adminDb } from '../_shared/db.ts'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Max-Age': '86400',
}

const MAX_SKILLS = 40 // tope de archivos por importación
const MAX_CONTENT = 60_000 // tope de chars por skill
const FETCH_TIMEOUT_MS = 12_000

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json; charset=utf-8' },
  })
}

// Extrae owner/repo (+ branch/path opcionales) de una URL de GitHub o de "owner/repo".
function parseRepo(input: string): { owner: string; repo: string; branch?: string; path?: string } | null {
  const safe = /^[A-Za-z0-9_.-]+$/
  let s = (input || '').trim()
  let branch: string | undefined
  let path: string | undefined
  const m = s.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/(?:tree|blob)\/([^/]+)(?:\/(.*))?)?\/?$/i)
  if (m) {
    const owner = m[1]
    const repo = m[2]
    branch = m[3]
    path = m[4]
    if (!safe.test(owner) || !safe.test(repo)) return null
    if (branch && !safe.test(branch)) return null
    if (path && !/^[A-Za-z0-9_./-]+$/.test(path)) return null
    return { owner, repo, branch, path: path?.replace(/\/$/, '') }
  }
  // "owner/repo"
  const p = s.replace(/^\/+|\/+$/g, '').split('/')
  if (p.length === 2 && safe.test(p[0]) && safe.test(p[1].replace(/\.git$/, ''))) {
    return { owner: p[0], repo: p[1].replace(/\.git$/, '') }
  }
  return null
}

async function ghFetch(url: string): Promise<Response> {
  const token = Deno.env.get('GITHUB_TOKEN')
  const headers: Record<string, string> = { 'User-Agent': 'nina-crm-skills', Accept: 'application/vnd.github+json' }
  if (token) headers.Authorization = `Bearer ${token}`
  // redirect:'manual' → no seguimos redirecciones fuera de github.com/raw.githubusercontent.com
  // (anti-SSRF en profundidad; los .md normales se sirven 200 directo, sin redirección).
  return await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
}

// Frontmatter YAML simple (name/description) + cuerpo. Sin dependencias.
function parseFrontmatter(raw: string): { name?: string; description?: string; body: string } {
  if (!raw.startsWith('---')) return { body: raw }
  const end = raw.indexOf('\n---', 3)
  if (end === -1) return { body: raw }
  const fm = raw.slice(3, end)
  const body = raw.slice(end + 4).replace(/^\s*\n/, '')
  const out: { name?: string; description?: string } = {}
  for (const line of fm.split('\n')) {
    const mm = line.match(/^\s*(name|description)\s*:\s*(.+?)\s*$/i)
    if (mm) out[mm[1].toLowerCase() as 'name' | 'description'] = mm[2].replace(/^["']|["']$/g, '')
  }
  return { ...out, body }
}

function deriveName(path: string): string {
  const parts = path.split('/')
  const base = parts[parts.length - 1]
  if (/^SKILL\.md$/i.test(base) && parts.length >= 2) return parts[parts.length - 2]
  return base.replace(/\.md$/i, '')
}

function firstMeaningfulLine(body: string): string {
  for (const line of body.split('\n')) {
    const t = line.replace(/^#+\s*/, '').trim()
    if (t) return t.slice(0, 200)
  }
  return ''
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS })

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return json({ error: 'Falta Authorization' }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: userData, error: userErr } = await callerClient.auth.getUser(token)
  if (userErr || !userData?.user) return json({ error: 'Token inválido' }, 401)

  let body: { repo?: string; agent_id?: string; branch?: string; path?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Body JSON inválido' }, 400)
  }

  const agentId = (body.agent_id ?? '').toString()
  if (!agentId) return json({ error: 'agent_id requerido' }, 400)
  const parsed = parseRepo(body.repo ?? '')
  if (!parsed) return json({ error: 'Repo inválido. Usa una URL de github.com o "owner/repo".' }, 400)

  // Autorización: el caller debe poder LEER el agente con SU sesión (RLS por marca).
  const { data: agent } = await callerClient.from('agents').select('id, brand_id').eq('id', agentId).maybeSingle()
  if (!agent) return json({ error: 'No tienes acceso a este agente' }, 403)

  const branch = body.branch && /^[A-Za-z0-9_.\-/]+$/.test(body.branch) ? body.branch : parsed.branch
  const subPath = (body.path && /^[A-Za-z0-9_./-]+$/.test(body.path) ? body.path : parsed.path)?.replace(/\/$/, '')

  try {
    // Branch por defecto si no se indicó.
    let ref = branch
    if (!ref) {
      const repoRes = await ghFetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}`)
      if (repoRes.status === 404) return json({ error: 'Repositorio no encontrado (¿es público?).' }, 404)
      if (!repoRes.ok) return json({ error: `GitHub respondió ${repoRes.status} (¿límite de tasa?).` }, 502)
      const dflt = (await repoRes.json())?.default_branch || 'main'
      // Validamos el branch (aunque venga de GitHub) con la misma regex que el resto de segmentos.
      ref = /^[A-Za-z0-9_.\-/]+$/.test(dflt) ? dflt : 'main'
    }

    // Árbol del repo.
    const treeRes = await ghFetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}/git/trees/${ref}?recursive=1`)
    if (!treeRes.ok) return json({ error: `No se pudo leer el repo (GitHub ${treeRes.status}).` }, 502)
    const tree = (await treeRes.json())?.tree
    if (!Array.isArray(tree)) return json({ error: 'Árbol del repo vacío o ilegible.' }, 502)

    let blobs = tree.filter((t: { type?: string; path?: string }) => t.type === 'blob' && typeof t.path === 'string')
    if (subPath) blobs = blobs.filter((t: { path: string }) => t.path === subPath || t.path.startsWith(`${subPath}/`))

    // Prioriza SKILL.md (convención Agent Skills); si no hay, toma .md (sin README/LICENSE/etc.).
    let files = blobs.filter((t: { path: string }) => /(^|\/)SKILL\.md$/i.test(t.path))
    if (!files.length) {
      const skip = /(^|\/)(README|LICENSE|CHANGELOG|CONTRIBUTING|CODE_OF_CONDUCT|SECURITY)\.md$/i
      files = blobs.filter((t: { path: string }) => /\.md$/i.test(t.path) && !skip.test(t.path))
    }
    if (!files.length) return json({ error: 'No encontré archivos de skill (.md) en el repo.' }, 404)
    files = files.slice(0, MAX_SKILLS)

    const sourceRepo = `${parsed.owner}/${parsed.repo}`
    const db = adminDb()
    // Skills ya importadas de este repo para esta marca → para actualizar en vez de duplicar.
    // OJO: brand_id puede ser null (agente de la junta) → con .eq(...,null) PostgREST nunca empareja;
    // hay que usar .is('brand_id', null) o el dedup falla y se acumulan duplicados.
    let exq = db.from('skills').select('id, source_path').eq('source_repo', sourceRepo)
    exq = agent.brand_id ? exq.eq('brand_id', agent.brand_id) : exq.is('brand_id', null)
    const { data: existing } = await exq
    const byPath = new Map<string, string>((existing ?? []).map((r: { id: string; source_path: string }) => [r.source_path, r.id]))

    const imported: { id: string; name: string }[] = []
    const skipped: { path: string; status: number }[] = []
    for (const f of files) {
      const rawRes = await ghFetch(`https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/${ref}/${f.path}`)
      if (!rawRes.ok) { skipped.push({ path: f.path, status: rawRes.status }); continue }
      let text = await rawRes.text()
      if (text.length > MAX_CONTENT) text = text.slice(0, MAX_CONTENT)
      const fm = parseFrontmatter(text)
      const name = (fm.name || deriveName(f.path)).slice(0, 120)
      const description = (fm.description || firstMeaningfulLine(fm.body)).slice(0, 400)
      const row = {
        brand_id: agent.brand_id ?? null,
        name,
        description,
        content: fm.body,
        source_repo: sourceRepo,
        source_path: f.path,
        created_by: userData.user.id,
        updated_at: new Date().toISOString(),
      }
      const prevId = byPath.get(f.path)
      let skillId = prevId
      if (prevId) {
        await db.from('skills').update(row).eq('id', prevId)
      } else {
        const { data: ins } = await db.from('skills').insert(row).select('id').maybeSingle()
        skillId = ins?.id
      }
      if (skillId) {
        await db.from('agent_skills').upsert({ agent_id: agentId, skill_id: skillId }, { onConflict: 'agent_id,skill_id' })
        imported.push({ id: skillId, name })
      }
    }

    return json({ ok: true, repo: sourceRepo, branch: ref, imported_count: imported.length, imported, skipped_count: skipped.length, skipped })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return json({ error: `Fallo importando: ${msg}` }, 500)
  }
})
