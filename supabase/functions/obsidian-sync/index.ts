// =====================================================================
// Edge Function: obsidian-sync
// Sincroniza el bucket "obsidian-vault" → brain de cada marca.
// Detecta cambios por hash, ingesta notas y convierte [[wiki-links]]
// en knowledge_relations con confidence 1.0.
// =====================================================================
import { createClient } from 'jsr:@supabase/supabase-js@^2'
import { runObsidianSync } from '../_shared/obsidian.ts'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceKey) {
    return json({ error: 'Variables de entorno de Supabase no configuradas' }, 500)
  }

  const db = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  try {
    const result = await runObsidianSync(db)

    return json({
      ok:                true,
      files_scanned:     result.filesScanned,
      files_ingested:    result.filesIngested,
      files_skipped:     result.filesSkipped,
      files_failed:      result.filesFailed,
      relations_created: result.relationsCreated,
      duration_ms:       result.durationMs,
      details:           result.details,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[obsidian-sync] Error:', message)
    return json({ ok: false, error: message }, 500)
  }
})

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS, 'content-type': 'application/json; charset=utf-8' },
  })
}
