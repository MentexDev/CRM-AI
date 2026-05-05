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

// ---------- Provider ----------
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  // cache local de profiles cuando estamos en Supabase, refrescada por realtime
  const [profilesCache, setProfilesCache] = useState([])

  const hydrateUserFromProfile = useCallback(async (authUser) => {
    if (!authUser) return null
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', authUser.id)
      .single()
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
      supabase.auth.getSession().then(async ({ data }) => {
        const u = await hydrateUserFromProfile(data.session?.user)
        if (active) {
          setUser(u)
          setLoading(false)
        }
      })
      const { data: sub } = supabase.auth.onAuthStateChange(async (_e, session) => {
        const u = await hydrateUserFromProfile(session?.user)
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
      // Verifica que no exista
      const { data: existing } = await supabase
        .from('profiles')
        .select('id')
        .ilike('username', username)
        .maybeSingle()
      if (existing) throw new Error(`El usuario ${username} ya existe`)

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            username,
            first_name: firstName.trim(),
            last_name: lastName.trim(),
            role: 'seller',
          },
        },
      })
      if (error) throw error

      // Asegurar que el goal queda guardado en el profile
      if (data.user?.id) {
        await supabase
          .from('profiles')
          .update({ goal: Number(goal) || DEFAULT_GOAL })
          .eq('id', data.user.id)
      }
      return {
        id: data.user?.id,
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
      // Borra el profile (la fila auth.users sigue existiendo pero pierde acceso al haber RLS).
      // Para borrar el auth.user requiere service_role; lo dejamos al admin desde el dashboard.
      const { error } = await supabase.from('profiles').delete().eq('id', id)
      if (error) throw error
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
