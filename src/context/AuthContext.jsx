import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)
const USER_CACHE_KEY = 'crm-ai:user-cache'

const cacheUser = (u) => {
  try {
    if (u) localStorage.setItem(USER_CACHE_KEY, JSON.stringify(u))
    else localStorage.removeItem(USER_CACHE_KEY)
  } catch {}
}
const loadCachedUser = () => {
  try {
    const raw = localStorage.getItem(USER_CACHE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

// Borra todo lo que Supabase guarda en localStorage. Lo usamos como fallback
// cuando el signOut server-side falla pero igual queremos cerrar sesión local.
const clearSupabaseLocal = () => {
  try {
    const keys = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && (k.startsWith('sb-') || k.startsWith('supabase.'))) keys.push(k)
    }
    keys.forEach((k) => localStorage.removeItem(k))
    localStorage.removeItem(USER_CACHE_KEY)
  } catch {}
}

const initials = (name = '') =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase() || 'NN'

const ROLE_LABEL = {
  junta: 'Junta Directiva',
  admin: 'Administrador',
  member: 'Miembro',
  viewer: 'Observador',
}

const withTimeout = (promise, ms, label = 'op') =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout ${label} (${ms}ms)`)), ms),
    ),
  ])

export function AuthProvider({ children }) {
  // Entrada inmediata desde cache; el hidrate de Supabase corre en background.
  const [user, setUser] = useState(() => loadCachedUser())
  const [loading, setLoading] = useState(() => !loadCachedUser())

  const hydrate = useCallback(async (authUser) => {
    if (!authUser) return null
    const { data, error } = await withTimeout(
      supabase.from('profiles').select('*').eq('id', authUser.id).maybeSingle(),
      8000,
      'hydrate profile',
    )
    if (error || !data) return null
    const fullName = data.full_name || authUser.email?.split('@')[0] || 'Usuario'
    return {
      id: data.id,
      email: data.email,
      fullName,
      avatarUrl: data.avatar_url || null,
      avatarText: initials(fullName),
      role: data.role,
      roleLabel: ROLE_LABEL[data.role] ?? data.role,
    }
  }, [])

  useEffect(() => {
    let active = true

    const init = async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession()
        if (!active) return

        if (!sessionData.session?.user) {
          setUser(null)
          cacheUser(null)
          return
        }

        // Validamos la sesión proactivamente: forzamos refresh. Si el
        // refresh_token también está vencido o revocado, falla acá y
        // limpiamos antes de que las queries fallen con 401 silencioso
        // (el bug de "no aparecen los agentes al recargar").
        try {
          const { error: refreshError } = await withTimeout(
            supabase.auth.refreshSession(),
            6000,
            'refresh session',
          )
          if (refreshError) {
            console.warn('[CRM-AI] refresh session falló, limpiando auth:', refreshError.message)
            try {
              await supabase.auth.signOut({ scope: 'local' })
            } catch {}
            clearSupabaseLocal()
            if (active) setUser(null)
            return
          }
        } catch (e) {
          // Network down o timeout: mantenemos cache si lo tenemos, no
          // borramos nada. Próximo evento de auth o focus volverá a probar.
          console.warn('[CRM-AI] refresh session timeout/error:', e)
        }

        // Re-leemos la sesión (puede haber sido refrescada) y hidratamos
        const { data: fresh } = await supabase.auth.getSession()
        if (!active) return
        if (!fresh.session?.user) {
          setUser(null)
          cacheUser(null)
          return
        }

        try {
          const u = await hydrate(fresh.session.user)
          if (!active) return
          if (u) {
            setUser(u)
            cacheUser(u)
          }
        } catch (e) {
          console.warn('[CRM-AI] hydrate falló (mantengo cache):', e)
        }
      } catch (err) {
        console.error('[CRM-AI] auth init error:', err)
      } finally {
        if (active) setLoading(false)
      }
    }
    init()

    const { data: sub } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT' || event === 'USER_DELETED') {
        if (active) setUser(null)
        cacheUser(null)
        return
      }
      // TOKEN_REFRESHED nos llega cuando el SDK refresca solo. Aprovechamos
      // para re-hidratar por si el profile cambió.
      if (!session?.user) return
      try {
        const u = await hydrate(session.user)
        if (active && u) {
          setUser(u)
          cacheUser(u)
        }
      } catch {}
    })

    // Cuando la pestaña vuelve al foco después de estar dormida, re-validamos.
    const onFocus = () => {
      supabase.auth.refreshSession().catch(() => {})
    }
    window.addEventListener('focus', onFocus)

    return () => {
      active = false
      sub.subscription.unsubscribe()
      window.removeEventListener('focus', onFocus)
    }
  }, [hydrate])

  const login = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      const msg = error.message?.toLowerCase().includes('invalid')
        ? 'Email o contraseña incorrectos'
        : error.message || 'No se pudo iniciar sesión'
      throw new Error(msg)
    }
    const u = await hydrate(data.user)
    if (u) cacheUser(u)
    return u
  }

  const logout = async () => {
    // 1. Limpiamos local PRIMERO — UI reacciona inmediato.
    cacheUser(null)
    setUser(null)
    // 2. signOut server-side con timeout corto. Si tarda o falla, no
    //    bloqueamos al usuario en una pantalla colgada.
    try {
      await withTimeout(supabase.auth.signOut(), 3000, 'signOut')
    } catch (err) {
      console.warn('[CRM-AI] signOut server falló (limpieza local):', err)
    }
    // 3. Cleanup defensivo de cualquier residuo de Supabase en localStorage.
    clearSupabaseLocal()
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        logout,
        isJunta: user?.role === 'junta',
        isAdmin: user?.role === 'admin' || user?.role === 'junta',
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
