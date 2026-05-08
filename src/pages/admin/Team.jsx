import { useEffect, useId, useState } from 'react'
import { motion } from 'framer-motion'
import { Loader2, Users } from 'lucide-react'
import EmptyState from '../../components/EmptyState'
import { supabase } from '../../lib/supabase'

const ROLE_LABEL = {
  junta: 'Junta Directiva',
  admin: 'Administrador',
  member: 'Miembro',
  viewer: 'Observador',
}
const ROLE_COLOR = {
  junta: 'bg-amber-500/10 border-amber-500/20 text-amber-300',
  admin: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300',
  member: 'bg-nina-line/40 border-nina-line text-nina-chrome',
  viewer: 'bg-nina-line/20 border-nina-line/50 text-nina-mute',
}

const initials = (name = '') =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase() || 'NN'

export default function Team() {
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const channelId = useId()

  useEffect(() => {
    let active = true
    const load = async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: true })
      if (!active) return
      if (error) console.error('[CRM-AI] profiles error:', error)
      setProfiles(data ?? [])
      setLoading(false)
    }
    load()

    const channel = supabase
      .channel(`profiles-all-${channelId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, load)
      .subscribe()

    return () => {
      active = false
      supabase.removeChannel(channel)
    }
  }, [channelId])

  if (loading) {
    return (
      <div className="grid place-items-center py-20 text-nina-mute">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    )
  }

  if (profiles.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="Sólo tú estás en el equipo"
        description="Pronto vas a poder invitar más humanos al holding y asignarles marcas."
      />
    )
  }

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-display text-2xl silver-text mb-1">Equipo humano</h2>
          <p className="text-sm text-nina-mute">
            Personas con acceso al holding. Sólo la Junta Directiva puede cambiar roles.
          </p>
        </div>
        <button className="btn-ghost text-xs" disabled title="Próximamente">
          + Invitar
        </button>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {profiles.map((p) => {
          const name = p.full_name || p.email
          return (
            <motion.div
              key={p.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="panel p-4 flex items-center gap-3"
            >
              <div className="w-12 h-12 rounded-full grid place-items-center bg-silver-gradient text-nina-black font-bold shadow-chrome flex-shrink-0">
                {initials(name)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-nina-chrome truncate">{name}</div>
                <div className="text-[11px] text-nina-mute truncate">{p.email}</div>
                <span className={`chip mt-1 ${ROLE_COLOR[p.role] ?? ROLE_COLOR.viewer} text-[10px]`}>
                  {ROLE_LABEL[p.role] ?? p.role}
                </span>
              </div>
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}
