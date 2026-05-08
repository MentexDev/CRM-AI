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

export function AuthProvider({ children }) {
  // Entrada inmediata desde cache; el hidrate de Supabase corre en background.
  const [user, setUser] = useState(() => loadCachedUser())
  const [loading, setLoading] = useState(() => !loadCachedUser())

  const hydrate = useCallback(async (authUser) => {
    if (!authUser) return null
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', authUser.id)
      .maybeSingle()
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
        const { data } = await supabase.auth.getSession()
        if (!active) return
        if (!data.session?.user) {
          setUser(null)
          cacheUser(null)
          return
        }
        const u = await hydrate(data.session.user)
        if (!active) return
        if (u) {
          setUser(u)
          cacheUser(u)
        }
      } catch (err) {
        console.error('[CRM-AI] auth init error:', err)
      } finally {
        if (active) setLoading(false)
      }
    }
    init()

    const { data: sub } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT') {
        if (active) setUser(null)
        cacheUser(null)
        return
      }
      if (!session?.user) return
      const u = await hydrate(session.user)
      if (active && u) {
        setUser(u)
        cacheUser(u)
      }
    })

    return () => {
      active = false
      sub.subscription.unsubscribe()
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
    try {
      await supabase.auth.signOut()
    } catch {}
    cacheUser(null)
    setUser(null)
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
