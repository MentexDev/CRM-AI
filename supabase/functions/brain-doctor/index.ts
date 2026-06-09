// Edge Function: brain-doctor — Auto-sanación del Brain
//
// Corre periódicamente (invocada por heartbeat o cron) y:
//   1. Detecta chunks sin embedding → los re-embebe
//   2. Detecta chunks duplicados (cosine > 0.97) → marca is_duplicate=true
//   3. Detecta documentos huérfanos (sin chunks) → los marca como 'orphaned'
//   4. Calcula health_score (0-100) y lo persiste en brain_health_log
//   5. Si health_score < 70 → crea tarea para el CEO Global con el reporte
import { adminDb } from '../_shared/db.ts'
import { embedTexts } from '../_shared/llm.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const DUPLICATE_SIMILARITY_THRESHOLD = 0.97
const HEALTH_ALERT_THRESHOLD = 70
const RE_EMBED_BATCH_SIZE = 50

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS })
  }

  const db = adminDb()
  const report: Record<string, unknown> = {}
  let chunksReembedded = 0
  let chunksDeduplicated = 0
  let docsOrphanedFound = 0

  try {
    // ── 1. Re-embeber chunks sin embedding ───────────────────────────
    const { data: missingEmbedding } = await db
      .from('knowledge_chunks')
      .select('id, content')
      .is('embedding', null)
      .eq('is_duplicate', false)
      .limit(RE_EMBED_BATCH_SIZE)

    if (missingEmbedding && missingEmbedding.length > 0) {
      const texts = missingEmbedding.map((c: { id: string; content: string }) => c.content)
      try {
        const embeddings = await embedTexts(texts)
        for (let i = 0; i < missingEmbedding.length; i++) {
          await db
            .from('knowledge_chunks')
            .update({ embedding: JSON.stringify(embeddings[i]) })
            .eq('id', missingEmbedding[i].id)
          chunksReembedded++
        }
      } catch {
        // Sin OPENAI_API_KEY — documentar en el reporte pero no fallar
        report.reembed_skipped = 'OPENAI_API_KEY no disponible'
      }
    }

    report.chunks_reembedded = chunksReembedded

    // ── 2. Deduplicación via función SQL ────────────────────────────
    // Buscamos pares de chunks con alta similaridad y marcamos el más viejo
    const { data: dupes } = await db.rpc('find_duplicate_chunks', {
      p_threshold: DUPLICATE_SIMILARITY_THRESHOLD,
      p_limit: 100,
    })

    if (dupes && dupes.length > 0) {
      const dupeIds = dupes.map((d: { older_id: string }) => d.older_id)
      const { error } = await db
        .from('knowledge_chunks')
        .update({ is_duplicate: true })
        .in('id', dupeIds)
      if (!error) chunksDeduplicated = dupeIds.length
    }

    report.chunks_deduplicated = chunksDeduplicated

    // ── 3. Documentos huérfanos (ingested pero sin chunks) ──────────
    const { data: orphans } = await db
      .from('knowledge_documents')
      .select('id')
      .eq('status', 'ingested')
      .not('id', 'in',
        db.from('knowledge_chunks').select('document_id')
      )
      .limit(50)

    if (orphans && orphans.length > 0) {
      const orphanIds = orphans.map((d: { id: string }) => d.id)
      await db
        .from('knowledge_documents')
        .update({ status: 'orphaned' })
        .in('id', orphanIds)
      docsOrphanedFound = orphanIds.length
    }

    report.docs_orphaned_found = docsOrphanedFound

    // ── 4. Métricas globales ────────────────────────────────────────
    const [
      { count: chunksTotal },
      { count: chunksMissingEmb },
      { count: chunksDupeTotal },
      { count: docsTotal },
      { count: docsOrphaned },
      { count: entitiesTotal },
    ] = await Promise.all([
      db.from('knowledge_chunks').select('*', { count: 'exact', head: true }),
      db.from('knowledge_chunks').select('*', { count: 'exact', head: true }).is('embedding', null),
      db.from('knowledge_chunks').select('*', { count: 'exact', head: true }).eq('is_duplicate', true),
      db.from('knowledge_documents').select('*', { count: 'exact', head: true }),
      db.from('knowledge_documents').select('*', { count: 'exact', head: true }).eq('status', 'orphaned'),
      db.from('knowledge_entities').select('*', { count: 'exact', head: true }),
    ])

    // ── 5. Calcular health_score ────────────────────────────────────
    // 100 puntos base, penalizamos por chunks sin embedding y duplicados
    let healthScore = 100
    if (chunksTotal && chunksTotal > 0) {
      const missingRatio = (chunksMissingEmb ?? 0) / chunksTotal
      const dupeRatio = (chunksDupeTotal ?? 0) / chunksTotal
      const orphanRatio = docsTotal ? (docsOrphaned ?? 0) / docsTotal : 0

      healthScore = Math.round(
        100
        - missingRatio * 50   // hasta -50 por chunks sin embedding
        - dupeRatio * 30      // hasta -30 por duplicados
        - orphanRatio * 20    // hasta -20 por documentos huérfanos
      )
    }

    healthScore = Math.max(0, Math.min(100, healthScore))

    // ── 6. Persistir en brain_health_log ───────────────────────────
    await db.from('brain_health_log').insert({
      health_score: healthScore,
      chunks_total: chunksTotal ?? 0,
      chunks_missing_embedding: chunksMissingEmb ?? 0,
      chunks_duplicate: chunksDupeTotal ?? 0,
      docs_total: docsTotal ?? 0,
      docs_orphaned: docsOrphaned ?? 0,
      entities_total: entitiesTotal ?? 0,
      report,
    })

    // ── 7. Alerta al CEO si salud está baja ────────────────────────
    if (healthScore < HEALTH_ALERT_THRESHOLD) {
      const { data: ceo } = await db
        .from('agents')
        .select('id')
        .eq('role', 'ceo_global')
        .maybeSingle()

      if (ceo) {
        await db.from('tasks').insert({
          agent_id: ceo.id,
          title: `🩺 Brain health crítico: ${healthScore}/100`,
          description: [
            `El brain-doctor detectó salud crítica (${healthScore}/100).`,
            '',
            `Chunks sin embedding: ${chunksMissingEmb ?? 0}/${chunksTotal ?? 0}`,
            `Chunks duplicados: ${chunksDupeTotal ?? 0}`,
            `Documentos huérfanos: ${docsOrphaned ?? 0}/${docsTotal ?? 0}`,
            `Entidades totales: ${entitiesTotal ?? 0}`,
            '',
            'Acciones tomadas automáticamente:',
            `- Re-embebidos: ${chunksReembedded} chunks`,
            `- Marcados como duplicado: ${chunksDeduplicated} chunks`,
            `- Marcados como huérfanos: ${docsOrphanedFound} documentos`,
          ].join('\n'),
          status: 'to_do',
          priority: 1,
          context: { source: 'brain_doctor', health_score: healthScore, report },
        })
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      health_score: healthScore,
      chunks_total: chunksTotal ?? 0,
      chunks_reembedded: chunksReembedded,
      chunks_deduplicated: chunksDeduplicated,
      docs_orphaned_found: docsOrphanedFound,
      entities_total: entitiesTotal ?? 0,
      report,
    }), {
      status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
