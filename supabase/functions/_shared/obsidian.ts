// =====================================================================
// Brain · Obsidian Sync — parseo de notas y grafo de wiki-links
// Markdown → frontmatter + [[wiki-links]] → entidades + relaciones
// =====================================================================
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@^2'
import { runIngestPipeline } from './ingest.ts'

const BUCKET = 'obsidian-vault'
const WIKILINK_PREDICATE = 'menciona'

// ─────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────

export interface SyncResult {
  filesScanned: number
  filesIngested: number
  filesSkipped: number
  filesFailed: number
  relationsCreated: number
  details: SyncDetail[]
  durationMs: number
}

interface SyncDetail {
  file: string
  status: 'ingested' | 'skipped' | 'failed' | 'no_brand'
  brand?: string
  wikilinks?: number
  error?: string
}

interface ParsedNote {
  frontmatter: Record<string, unknown>
  body: string
  wikilinks: string[]
}

// ─────────────────────────────────────────────────────────────────────
// Entrypoint: sincroniza toda la bóveda
// ─────────────────────────────────────────────────────────────────────

export async function runObsidianSync(db: SupabaseClient): Promise<SyncResult> {
  const startedAt = Date.now()

  const files = await listMarkdownFiles(db)

  const result: SyncResult = {
    filesScanned:     files.length,
    filesIngested:    0,
    filesSkipped:     0,
    filesFailed:      0,
    relationsCreated: 0,
    details:          [],
    durationMs:       0,
  }

  // Cache de marcas (slug/name → id) para no consultar por archivo
  const brandMap = await loadBrandMap(db)

  for (const filePath of files) {
    try {
      const detail = await syncSingleNote(db, filePath, brandMap)
      result.details.push(detail)

      if (detail.status === 'ingested') {
        result.filesIngested++
        result.relationsCreated += detail.wikilinks ?? 0
      } else if (detail.status === 'skipped') {
        result.filesSkipped++
      } else if (detail.status === 'no_brand') {
        result.filesSkipped++
      } else {
        result.filesFailed++
      }
    } catch (err) {
      result.filesFailed++
      result.details.push({
        file:   filePath,
        status: 'failed',
        error:  err instanceof Error ? err.message : String(err),
      })
    }
  }

  result.durationMs = Date.now() - startedAt
  return result
}

// ─────────────────────────────────────────────────────────────────────
// Sincroniza una nota individual
// ─────────────────────────────────────────────────────────────────────

async function syncSingleNote(
  db: SupabaseClient,
  filePath: string,
  brandMap: Record<string, string>,
): Promise<SyncDetail> {
  // 1. Descargar contenido
  const rawContent = await downloadFile(db, filePath)
  const hash = await sha256(rawContent)

  // 2. ¿Ya está sincronizado con el mismo hash? → skip
  const { data: prior } = await db
    .from('obsidian_sync_state')
    .select('id, content_hash, document_id')
    .eq('file_path', filePath)
    .maybeSingle()

  if (prior && prior.content_hash === hash) {
    return { file: filePath, status: 'skipped' }
  }

  // 3. Parsear frontmatter + wiki-links
  const note = parseNote(rawContent)

  // 4. Resolver marca (híbrido: frontmatter override → carpeta)
  const brandId = resolveBrandId(filePath, note.frontmatter, brandMap)
  if (!brandId) {
    return { file: filePath, status: 'no_brand' }
  }

  // 5. Si había una versión previa, borrar el documento viejo (cascade chunks)
  if (prior?.document_id) {
    await db.from('knowledge_documents').delete().eq('id', prior.document_id)
  }

  // 6. Reusar el pipeline de ingesta (chunks + embeddings + entidades LLM)
  const title = extractTitle(note, filePath)
  const ingest = await runIngestPipeline(
    {
      brandId,
      title,
      content:    note.body,
      sourceKind: 'obsidian',
      sourceUri:  filePath,
      metadata:   { frontmatter: note.frontmatter, wikilinks: note.wikilinks },
    },
    db,
  )

  // 7. La nota misma es una entidad (nodo del grafo)
  const noteEntityId = await upsertNoteEntity(db, brandId, title, note)

  // 8. Cada [[wiki-link]] → arista con confidence 1.0
  let relationsCreated = 0
  for (const target of note.wikilinks) {
    const targetEntityId = await upsertGhostEntity(db, brandId, target)
    if (targetEntityId && targetEntityId !== noteEntityId) {
      const ok = await createWikiRelation(db, brandId, noteEntityId, targetEntityId)
      if (ok) relationsCreated++
    }
  }

  // 9. Guardar el estado de sync
  await db.from('obsidian_sync_state').upsert(
    {
      brand_id:       brandId,
      file_path:      filePath,
      content_hash:   hash,
      document_id:    ingest.documentId,
      note_entity_id: noteEntityId,
      wikilinks:      note.wikilinks,
      last_synced_at: new Date().toISOString(),
    },
    { onConflict: 'file_path' },
  )

  const brandName = Object.entries(brandMap).find(([, id]) => id === brandId)?.[0]
  return {
    file:      filePath,
    status:    'ingested',
    brand:     brandName,
    wikilinks: relationsCreated,
  }
}

// ─────────────────────────────────────────────────────────────────────
// Parseo: frontmatter + body + wiki-links
// ─────────────────────────────────────────────────────────────────────

export function parseNote(raw: string): ParsedNote {
  const { frontmatter, body } = parseFrontmatter(raw)
  const wikilinks = parseWikiLinks(body)
  return { frontmatter, body, wikilinks }
}

// Parser minimalista de frontmatter YAML (--- ... ---)
// Soporta: key: value, listas inline [a, b], y valores string simples.
export function parseFrontmatter(raw: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match) return { frontmatter: {}, body: raw }

  const [, yamlBlock, body] = match
  const frontmatter: Record<string, unknown> = {}

  for (const line of yamlBlock.split('\n')) {
    const kv = line.match(/^(\w[\w-]*):\s*(.*)$/)
    if (!kv) continue
    const key = kv[1].trim()
    let value: unknown = kv[2].trim()

    // Lista inline: [a, b, c]
    if (typeof value === 'string' && value.startsWith('[') && value.endsWith(']')) {
      value = value
        .slice(1, -1)
        .split(',')
        .map(v => v.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean)
    } else if (typeof value === 'string') {
      value = value.replace(/^["']|["']$/g, '') // quitar comillas
    }

    frontmatter[key] = value
  }

  return { frontmatter, body: body.trim() }
}

// Extrae todos los [[wiki-links]], ignorando alias [[destino|alias]]
// y anclas [[destino#sección]]. Devuelve nombres únicos.
export function parseWikiLinks(text: string): string[] {
  const WIKILINK_RE = /\[\[([^\]]+)\]\]/g
  const links = new Set<string>()
  let m: RegExpExecArray | null

  while ((m = WIKILINK_RE.exec(text)) !== null) {
    // [[destino|alias]] → destino  |  [[destino#sección]] → destino
    const target = m[1].split('|')[0].split('#')[0].trim()
    if (target.length > 0) links.add(target)
  }

  return [...links]
}

function extractTitle(note: ParsedNote, filePath: string): string {
  // Prioridad: frontmatter.title → primer H1 → nombre del archivo
  if (typeof note.frontmatter.title === 'string' && note.frontmatter.title.trim()) {
    return note.frontmatter.title.trim()
  }
  const h1 = note.body.match(/^#\s+(.+)$/m)
  if (h1) return h1[1].trim()

  const fileName = filePath.split('/').pop() ?? filePath
  return fileName.replace(/\.md$/i, '')
}

// ─────────────────────────────────────────────────────────────────────
// Resolución de marca (híbrido: frontmatter override → carpeta)
// ─────────────────────────────────────────────────────────────────────

export function resolveBrandId(
  filePath: string,
  frontmatter: Record<string, unknown>,
  brandMap: Record<string, string>,
): string | null {
  // 1. Override explícito por frontmatter gana siempre
  if (typeof frontmatter.brand === 'string') {
    const id = brandMap[frontmatter.brand.trim().toLowerCase()]
    if (id) return id
  }

  // 2. Default: primera carpeta bajo la raíz de la bóveda
  //    "NINA/colecciones.md" → "nina"  |  "vault/NINA/x.md" → "vault" (ajustar prefijo si aplica)
  const parts = filePath.split('/').filter(Boolean)
  if (parts.length >= 2) {
    const folder = parts[0].toLowerCase()
    if (brandMap[folder]) return brandMap[folder]
  }

  // 3. Sin marca resoluble → null (la nota se omite, no se ingesta huérfana)
  return null
}

async function loadBrandMap(db: SupabaseClient): Promise<Record<string, string>> {
  const { data } = await db.from('brands').select('id, slug, name')
  const map: Record<string, string> = {}
  for (const b of data ?? []) {
    if (b.slug) map[b.slug.toLowerCase()] = b.id
    if (b.name) map[b.name.toLowerCase()] = b.id
  }
  return map
}

// ─────────────────────────────────────────────────────────────────────
// Grafo: entidades de nota + entidades fantasma + relaciones
// ─────────────────────────────────────────────────────────────────────

async function upsertNoteEntity(
  db: SupabaseClient,
  brandId: string,
  title: string,
  note: ParsedNote,
): Promise<string> {
  const { data: existing } = await db
    .from('knowledge_entities')
    .select('id, mention_count')
    .eq('brand_id', brandId)
    .ilike('name', title)
    .maybeSingle()

  const description = `Nota de Obsidian: ${title}`

  if (existing) {
    await db
      .from('knowledge_entities')
      .update({ mention_count: existing.mention_count + 1, description, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
    return existing.id
  }

  const { data: created, error } = await db
    .from('knowledge_entities')
    .insert({ brand_id: brandId, kind: 'concept', name: title, description })
    .select('id')
    .single()

  if (error) {
    // Carrera: otro insert ganó → buscar
    const { data: race } = await db
      .from('knowledge_entities')
      .select('id')
      .eq('brand_id', brandId)
      .ilike('name', title)
      .maybeSingle()
    if (race) return race.id
    throw new Error(`No se pudo crear la entidad de nota: ${error.message}`)
  }

  return created.id
}

// Entidad "fantasma": destino de un wiki-link que aún no tiene nota propia.
// Se crea como placeholder y se completa cuando esa nota se ingesta.
async function upsertGhostEntity(
  db: SupabaseClient,
  brandId: string,
  name: string,
): Promise<string | null> {
  const { data: existing } = await db
    .from('knowledge_entities')
    .select('id')
    .eq('brand_id', brandId)
    .ilike('name', name)
    .maybeSingle()

  if (existing) return existing.id

  const { data: created, error } = await db
    .from('knowledge_entities')
    .insert({
      brand_id:    brandId,
      kind:        'concept',
      name:        name,
      description: `Referencia pendiente (link de Obsidian sin nota propia aún)`,
      metadata:    { ghost: true },
    })
    .select('id')
    .single()

  if (error) {
    if (error.code === '23505') {
      const { data: race } = await db
        .from('knowledge_entities')
        .select('id')
        .eq('brand_id', brandId)
        .ilike('name', name)
        .maybeSingle()
      return race?.id ?? null
    }
    return null
  }

  return created.id
}

async function createWikiRelation(
  db: SupabaseClient,
  brandId: string,
  sourceId: string,
  targetId: string,
): Promise<boolean> {
  const { error } = await db.from('knowledge_relations').insert({
    brand_id:         brandId,
    source_entity_id: sourceId,
    target_entity_id: targetId,
    predicate:        WIKILINK_PREDICATE,
    confidence:       1.0,   // link explícito escrito por el humano → confianza total
  })

  // 23505 = la arista ya existe (unique constraint) → no es error
  return !error || error.code === '23505'
}

// ─────────────────────────────────────────────────────────────────────
// Storage: listado recursivo + descarga + hashing
// ─────────────────────────────────────────────────────────────────────

async function listMarkdownFiles(db: SupabaseClient, prefix = ''): Promise<string[]> {
  const results: string[] = []

  const { data, error } = await db.storage.from(BUCKET).list(prefix, {
    limit: 1000,
    sortBy: { column: 'name', order: 'asc' },
  })
  if (error) throw new Error(`Error listando Storage: ${error.message}`)

  for (const item of data ?? []) {
    const path = prefix ? `${prefix}/${item.name}` : item.name

    // Un item sin id/metadata es una carpeta → recursar
    if (item.id === null) {
      const nested = await listMarkdownFiles(db, path)
      results.push(...nested)
    } else if (item.name.toLowerCase().endsWith('.md')) {
      results.push(path)
    }
  }

  return results
}

async function downloadFile(db: SupabaseClient, path: string): Promise<string> {
  const { data, error } = await db.storage.from(BUCKET).download(path)
  if (error) throw new Error(`Error descargando ${path}: ${error.message}`)
  return await data.text()
}

async function sha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}
