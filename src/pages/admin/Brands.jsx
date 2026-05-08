import { useEffect, useId, useState } from 'react'
import { motion } from 'framer-motion'
import { Loader2, Sparkles } from 'lucide-react'
import EmptyState from '../../components/EmptyState'
import { supabase } from '../../lib/supabase'

const STATUS_BADGE = {
  active: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300',
  paused: 'bg-amber-500/10 border-amber-500/20 text-amber-300',
  archived: 'bg-nina-line/40 border-nina-line text-nina-mute',
}

export default function Brands() {
  const [brands, setBrands] = useState([])
  const [loading, setLoading] = useState(true)
  const channelId = useId()

  useEffect(() => {
    let active = true
    const load = async () => {
      const { data, error } = await supabase
        .from('brands')
        .select('*')
        .order('created_at', { ascending: true })
      if (!active) return
      if (error) console.error('[CRM-AI] brands error:', error)
      setBrands(data ?? [])
      setLoading(false)
    }
    load()

    const channel = supabase
      .channel(`brands-all-${channelId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'brands' }, load)
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

  if (brands.length === 0) {
    return (
      <EmptyState
        icon={Sparkles}
        title="Aún no hay marcas registradas"
        description="Las marcas son los universos que el CRM gestiona. Crear marcas estará disponible en el siguiente release."
      />
    )
  }

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-display text-2xl silver-text mb-1">Marcas del holding</h2>
          <p className="text-sm text-nina-mute">
            Cada marca tiene su propio Brand Manager y vive aislada del resto.
          </p>
        </div>
        <button className="btn-ghost text-xs" disabled title="Próximamente">
          + Nueva marca
        </button>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {brands.map((b) => (
          <motion.div
            key={b.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="panel p-5 space-y-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-display text-2xl silver-text">{b.name}</div>
                <div className="text-[11px] uppercase tracking-[0.2em] text-nina-mute mt-0.5">
                  {b.slug}
                </div>
              </div>
              <span className={`chip ${STATUS_BADGE[b.status] ?? STATUS_BADGE.archived} text-[10px]`}>
                {b.status}
              </span>
            </div>
            {b.description && (
              <p className="text-sm text-nina-chrome leading-relaxed line-clamp-6">
                {b.description}
              </p>
            )}
            {b.brand_voice && (
              <div className="rounded-lg bg-nina-ink/60 border border-nina-line p-3">
                <div className="text-[10px] uppercase tracking-[0.18em] text-nina-mute mb-1">
                  Voz de marca
                </div>
                <div className="text-[12px] text-nina-chrome leading-relaxed">
                  {b.brand_voice}
                </div>
              </div>
            )}
          </motion.div>
        ))}
      </div>
    </div>
  )
}
