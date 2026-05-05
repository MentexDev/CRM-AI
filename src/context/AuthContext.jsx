import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { seedSellers, buildUsername, DEFAULT_GOAL } from '../lib/seed'

const AuthContext = createContext(null)
const SESSION_KEY = 'nina:session'
const USERS_KEY = 'nina:users:v2'

// ---------- helpers locales (modo fallback sin Supabase) ----------
const migrate = (users) =>
  users.map((u) => {
    if (u.username) return u
    const [firstName, ...rest] = (u.name || '').split(' ')
    const lastName = rest.join(' ') || firstName
    return {
      ...u,
      firstName: u.firstName || firstName || '',
      lastName: u.lastName || lastName || '',
      username: buildUsername(firstName, lastName),
    }
  })

const loadUsersLocal = () => {
  try {
    const raw = localStorage.getItem(USERS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      const migrated = migrate(parsed)
      if (JSON.stringify(parsed) !== JSON.stringify(migrated)) {
        localStorage.setItem(USERS_KEY, JSON.stringify(migrated))
      }
      return migrated
    }
  } catch {}
  localStorage.setItem(USERS_KEY, JSON.stringify(seedSellers))
  return seedSellers
}

const saveUsersLocal = (users) => localStorage.setItem(USERS_KEY, JSON.stringify(users))

const avatarFor = (firstName, lastName) =>
  `${(firstName || ' ')[0] || ''}${(lastName || ' ')[0] || ''}`.toUpperCase() || 'NN'

// Username (NINAnombre.apellido) → email sintético para Supabase Auth
// .app porque Supabase rechaza .local (RFC 6762, dominio reservado)
const usernameToEmail = (username) =>
  `${String(username || '').toLowerCase()}@nina.app`

// Llama la Edge Function admin-sellers con la JWT del admin actual.
// La function valida el role y ejecuta create/delete con service_role.
const callAdminFn = async (action, payload) => {
  const supaUrl = import.meta.env.VITE_SUPABASE_URL
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData?.session?.access_token
  if (!token) throw new Error('Sesión expirada, vuelve a iniciar sesión')

  const res = await fetch(`${supaUrl}/functions/v1/quick-action`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action, ...payload }),
  })
  const text = await res.text()
  let data = {}
  try {
    data = JSON.parse(text)
  } catch {
    data = { error: text }
  }
  if (!res.ok) {
    throw new Error(
      data.error ||
        'No se pudo procesar — verifica que la Edge Function quick-action esté desplegada en Supabase',
    )
  }
  return data
}

// ---------- Provider ----------
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  // cache local de profiles cuando estamos en Supabase, refrescada por realtime
  const [profilesCache, setProfilesCache] = useState([])

  // Helper: race con timeout — si la promesa no resuelve a tiempo, lanza
  const withTimeout = (promise, ms, label = 'operación') =>
    Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout ${label} (${ms}ms)`)), ms),
      ),
    ])

  const hydrateUserFromProfile = useCallback(async (authUser) => {
    if (!authUser) return null
    // Pequeño helper para reintentar la query del profile hasta 3 veces
    const fetchProfile = async () => {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const { data, error } = await withTimeout(
            supabase.from('profiles').select('*').eq('id', authUser.id).maybeSingle(),
            10000,
            `hydrate profile (intento ${attempt})`,
          )
          if (error) {
            console.warn(`[NINA] hydrate intento ${attempt}:`, error)
            if (attempt === 3) return null
          } else {
            return data
          }
        } catch (err) {
          console.warn(`[NINA] hydrate intento ${attempt} timeout:`, err)
          if (attempt === 3) return null
        }
        // backoff entre reintentos: 500ms, 1500ms
        await new Promise((r) => setTimeout(r, attempt * 500))
      }
      return null
    }

    const profile = await fetchProfile()
    if (!profile) return null
    return {
      id: profile.id,
      username: profile.username,
      firstName: profile.first_name,
      lastName: profile.last_name,
      name: `${profile.first_name} ${profile.last_name}`.trim(),
      role: profile.role,
      avatar: profile.avatar,
      goal: Number(profile.goal) || 0,
    }
  }, [])

  // Sesión inicial + suscripción a cambios de auth
  useEffect(() => {
    let active = true

    if (isSupabaseConfigured) {
      const init = async () => {
        try {
          const { data } = await withTimeout(
            supabase.auth.getSession(),
            10000,
            'getSession',
          )
          if (!active) return
          // Sin sesión → al login (es lo que esperamos al primer load)
          if (!data.session?.user) {
            setUser(null)
            return
          }
          const u = await hydrateUserFromProfile(data.session.user)
          if (!active) return
          if (u) {
            setUser(u)
          } else {
            // Hay sesión válida pero no pudimos cargar el profile.
            // NO hacemos signOut: dejamos al usuario reintentar.
            // Como mínimo seteamos un user básico para que pueda ver la app
            // (el role queda undefined, así que el routing lo lleva a /vendedora
            // por default — si no carga, tiene los botones de stuck).
            console.warn('[NINA] Sesión válida pero profile no disponible')
            setUser(null)
          }
        } catch (err) {
          // Red caída o Supabase lento: NO borramos la sesión, solo dejamos
          // user=null para que React Router lleve al login. Si la sesión
          // sigue en localStorage, en el próximo refresh debería entrar.
          console.error('[NINA] Auth init error:', err)
          if (active) setUser(null)
        } finally {
          if (active) setLoading(false)
        }
      }
      init()

      const { data: sub } = supabase.auth.onAuthStateChange(async (event, session) => {
        // SIGNED_OUT, TOKEN_REFRESHED, USER_UPDATED, SIGNED_IN
        if (event === 'SIGNED_OUT' || !session) {
          if (active) setUser(null)
          return
        }
        const u = await hydrateUserFromProfile(session.user)
        if (active) setUser(u)
      })
      return () => {
        active = false
        sub.subscription.unsubscribe()
      }
    }

    // Fallback local
    try {
      const raw = localStorage.getItem(SESSION_KEY)
      if (raw) setUser(JSON.parse(raw))
    } catch {}
    setLoading(false)
    return () => {
      active = false
    }
  }, [hydrateUserFromProfile])

  // Suscripción a profiles para mantener listSellers() actualizado
  useEffect(() => {
    if (!isSupabaseConfigured) return
    let active = true
    const fetchProfiles = async () => {
      const { data } = await supabase.from('profiles').select('*').order('created_at')
      if (active && data) setProfilesCache(data)
    }
    fetchProfiles()
    const channel = supabase
      .channel('profiles-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => {
        fetchProfiles()
      })
      .subscribe()
    return () => {
      active = false
      supabase.removeChannel(channel)
    }
  }, [])

  // ============= LOGIN / LOGOUT =============
  const login = async (username, password) => {
    if (isSupabaseConfigured) {
      const email = usernameToEmail(username)
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        if (error.message?.toLowerCase().includes('invalid')) {
          throw new Error('Usuario o contraseña incorrectos')
        }
        throw error
      }
      return await hydrateUserFromProfile(data.user)
    }
    // Fallback local
    const users = loadUsersLocal()
    const u = users.find(
      (x) =>
        (x.username || '').toLowerCase() === String(username).toLowerCase() &&
        x.password === password,
    )
    if (!u) throw new Error('Usuario o contraseña incorrectos')
    const sessionUser = {
      id: u.id,
      username: u.username,
      name: u.name,
      role: u.role,
      avatar: u.avatar,
      goal: u.goal,
    }
    localStorage.setItem(SESSION_KEY, JSON.stringify(sessionUser))
    setUser(sessionUser)
    return sessionUser
  }

  const logout = async () => {
    if (isSupabaseConfigured) {
      await supabase.auth.signOut()
    }
    localStorage.removeItem(SESSION_KEY)
    setUser(null)
  }

  // ============= REGISTRO / CRUD VENDEDORAS =============
  const registerSeller = async ({ firstName, lastName, password, goal = DEFAULT_GOAL }) => {
    if (!firstName?.trim() || !lastName?.trim())
      throw new Error('Nombre y apellido son obligatorios')
    if (!password || password.length < 4)
      throw new Error('La contraseña debe tener al menos 4 caracteres')

    const username = buildUsername(firstName, lastName)
    const email = usernameToEmail(username)

    if (isSupabaseConfigured) {
      // Toda la lógica (verificar duplicado, crear user, set goal) ocurre
      // dentro de la Edge Function con service_role. El cliente principal
      // del admin NO hace ninguna query, así su token de sesión queda
      // 100% intacto y no hay race conditions con el SDK.
      const result = await callAdminFn('create', {
        email,
        password,
        username,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        goal: Number(goal) || DEFAULT_GOAL,
      })
      return {
        id: result.id,
        username,
        name: `${firstName.trim()} ${lastName.trim()}`,
      }
    }

    // Fallback local
    const users = loadUsersLocal()
    if (users.some((u) => (u.username || '').toLowerCase() === username.toLowerCase())) {
      throw new Error(`El usuario ${username} ya existe`)
    }
    const newUser = {
      id: `sel-${Date.now()}`,
      username,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      name: `${firstName.trim()} ${lastName.trim()}`,
      password,
      role: 'seller',
      avatar: avatarFor(firstName, lastName),
      goal: Number(goal) || DEFAULT_GOAL,
    }
    saveUsersLocal([...users, newUser])
    return newUser
  }

  const removeSeller = async (id) => {
    if (isSupabaseConfigured) {
      // La Edge Function elimina el user de auth.users con service_role.
      // El profile se elimina en cascade gracias a la FK profiles_id_fkey.
      await callAdminFn('delete', { user_id: id })
      return
    }
    saveUsersLocal(loadUsersLocal().filter((u) => u.id !== id))
  }

  const updateSeller = async (id, patch) => {
    if (isSupabaseConfigured) {
      const supaPatch = {}
      if (patch.firstName !== undefined) supaPatch.first_name = patch.firstName
      if (patch.lastName !== undefined) supaPatch.last_name = patch.lastName
      if (patch.goal !== undefined) supaPatch.goal = Number(patch.goal) || 0
      if (patch.firstName !== undefined || patch.lastName !== undefined) {
        const fn = patch.firstName ?? ''
        const ln = patch.lastName ?? ''
        if (fn && ln) {
          supaPatch.username = buildUsername(fn, ln)
          supaPatch.avatar = avatarFor(fn, ln)
        }
      }
      if (Object.keys(supaPatch).length > 0) {
        const { error } = await supabase.from('profiles').update(supaPatch).eq('id', id)
        if (error) throw error
      }
      // Cambio de password = recovery email (opcional, no implementado aquí)
      return
    }
    const users = loadUsersLocal().map((u) => {
      if (u.id !== id) return u
      const merged = { ...u, ...patch }
      if (patch.firstName !== undefined || patch.lastName !== undefined) {
        merged.username = buildUsername(merged.firstName, merged.lastName)
        merged.name = `${merged.firstName} ${merged.lastName}`.trim()
        merged.avatar = avatarFor(merged.firstName, merged.lastName)
      }
      return merged
    })
    saveUsersLocal(users)
  }

  const listSellers = useCallback(() => {
    if (isSupabaseConfigured) {
      return profilesCache.map((p) => ({
        id: p.id,
        username: p.username,
        firstName: p.first_name,
        lastName: p.last_name,
        name: `${p.first_name} ${p.last_name}`.trim(),
        role: p.role,
        avatar: p.avatar,
        goal: Number(p.goal) || 0,
        password: '••••••', // no se expone
      }))
    }
    return loadUsersLocal()
  }, [profilesCache])

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        logout,
        registerSeller,
        removeSeller,
        updateSeller,
        listSellers,
        isAdmin: user?.role === 'admin',
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
