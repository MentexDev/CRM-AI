import { createContext, useContext, useEffect, useState } from 'react'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { seedSellers, buildUsername, DEFAULT_GOAL } from '../lib/seed'

const AuthContext = createContext(null)
const SESSION_KEY = 'nina:session'
const USERS_KEY = 'nina:users:v2'

// Migra usuarios viejos (sin username) al nuevo esquema con prefijo NINA
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

const loadUsers = () => {
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

const saveUsers = (users) => localStorage.setItem(USERS_KEY, JSON.stringify(users))

const avatarFor = (firstName, lastName) =>
  `${(firstName || ' ')[0] || ''}${(lastName || ' ')[0] || ''}`.toUpperCase() || 'NN'

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (isSupabaseConfigured) {
      supabase.auth.getSession().then(({ data }) => {
        setUser(data.session?.user || null)
        setLoading(false)
      })
      const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
        setUser(session?.user || null)
      })
      return () => sub.subscription.unsubscribe()
    }
    try {
      const raw = localStorage.getItem(SESSION_KEY)
      if (raw) setUser(JSON.parse(raw))
    } catch {}
    setLoading(false)
  }, [])

  const login = async (username, password) => {
    if (isSupabaseConfigured) {
      // Cuando enchufemos Supabase: el username se mapea a un email sintético tipo `${username}@nina.local`
      const email = `${username.toLowerCase()}@nina.local`
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error
      return data.user
    }
    const users = loadUsers()
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
    }
    localStorage.setItem(SESSION_KEY, JSON.stringify(sessionUser))
    setUser(sessionUser)
    return sessionUser
  }

  const logout = async () => {
    if (isSupabaseConfigured) await supabase.auth.signOut()
    localStorage.removeItem(SESSION_KEY)
    setUser(null)
  }

  const registerSeller = ({ firstName, lastName, password, goal = DEFAULT_GOAL }) => {
    if (!firstName?.trim() || !lastName?.trim())
      throw new Error('Nombre y apellido son obligatorios')
    if (!password || password.length < 4)
      throw new Error('La contraseña debe tener al menos 4 caracteres')

    const username = buildUsername(firstName, lastName)
    const users = loadUsers()
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
    saveUsers([...users, newUser])
    return newUser
  }

  const removeSeller = (id) => {
    const users = loadUsers().filter((u) => u.id !== id)
    saveUsers(users)
  }

  const updateSeller = (id, patch) => {
    const users = loadUsers().map((u) => {
      if (u.id !== id) return u
      const merged = { ...u, ...patch }
      // Si cambian nombre/apellido regeneramos username, name y avatar
      if (patch.firstName !== undefined || patch.lastName !== undefined) {
        merged.username = buildUsername(merged.firstName, merged.lastName)
        merged.name = `${merged.firstName} ${merged.lastName}`.trim()
        merged.avatar = avatarFor(merged.firstName, merged.lastName)
      }
      return merged
    })
    saveUsers(users)
  }

  const listSellers = () => loadUsers()

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
