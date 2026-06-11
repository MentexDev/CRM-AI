// =====================================================================
// _shared/auth.ts — Guardia de autenticación para Edge Functions
// máquina-a-máquina (cron/heartbeat ↔ Supabase).
//
// Los llamadores internos (cron/heartbeat) llaman a estas funciones con la
// cabecera `X-Engine-Key`, cuyo valor vive SOLO en los secrets de Supabase
// (nunca en el navegador). Sin esa clave —o si no coincide— se
// rechaza con 401. Si la clave no está configurada en el entorno de la
// función, se rechaza con 503 (fail-closed: NUNCA se sirve sin verificar).
//
// Antes, estas funciones usaban service_role (bypass RLS) sin verificar
// identidad y dependían sólo del anon key (que es público). Esta guardia es
// el control real de acceso.
// =====================================================================

// Comparación en tiempo (cuasi)constante: no corta al primer byte distinto,
// para no filtrar información por timing.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

const AUTH_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-engine-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/**
 * Exige una `X-Engine-Key` válida. Devuelve una `Response` de error (401/503)
 * si falla, o `null` si la petición está autorizada para continuar.
 *
 * Uso al inicio del handler (después de manejar OPTIONS):
 *   const denied = requireEngineKey(req)
 *   if (denied) return denied
 */
export function requireEngineKey(req: Request): Response | null {
  const expected = Deno.env.get('ENGINE_API_KEY')
  if (!expected) {
    return jsonAuth(
      { error: 'Motor mal configurado: falta ENGINE_API_KEY en los secrets de Supabase' },
      503,
    )
  }
  const provided = req.headers.get('X-Engine-Key') ?? ''
  if (!provided || !safeEqual(provided, expected)) {
    return jsonAuth({ error: 'No autorizado: X-Engine-Key inválida o ausente' }, 401)
  }
  return null
}

function jsonAuth(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...AUTH_CORS, 'content-type': 'application/json; charset=utf-8' },
  })
}
