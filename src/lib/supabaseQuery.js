import { supabase } from './supabase'

// Detecta si un error de Supabase/PostgREST es por sesión expirada o JWT
// inválido. Cuando el access_token guardado en memoria del SDK ya venció
// pero todavía no se refrescó (caso típico al recargar la pestaña), las
// queries devuelven con uno de estos sintomas y NO data.
const isAuthError = (err) => {
  if (!err) return false
  const code = err.code || err.statusCode || err.status
  const msg = String(err.message || '').toLowerCase()
  return (
    code === 401 ||
    code === 'PGRST301' ||
    code === 'PGRST302' ||
    msg.includes('jwt') ||
    msg.includes('expired') ||
    msg.includes('not authenticated')
  )
}

/**
 * Ejecuta una query Supabase. Si falla por auth, fuerza refreshSession()
 * y reintenta UNA vez. Usar así:
 *
 *   const { data, error } = await withAuthRetry(() =>
 *     supabase.from('agents').select('*').order('name')
 *   )
 *
 * `buildQuery` debe ser una *factoría* que devuelve una nueva query cada
 * vez (no la query ya invocada), porque PostgrestBuilder no se puede
 * re-await después de la primera resolución.
 */
export async function withAuthRetry(buildQuery) {
  let result = await buildQuery()
  if (!isAuthError(result?.error)) return result

  try {
    await supabase.auth.refreshSession()
  } catch {
    return result // si el refresh también falla, devolvemos el error original
  }
  return await buildQuery()
}
