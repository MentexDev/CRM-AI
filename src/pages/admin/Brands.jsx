import { useEffect, useId, useState } from 'react'
import { motion } from 'framer-motion'
import { Loader2, Pencil, Plus, Sparkles } from 'lucide-react'
import EmptyState from '../../components/EmptyState'
import NewBrandModal from '../../components/NewBrandModal'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'

const STATUS_BADGE = {
  active: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300',
  paused: 'bg-amber-500/10 border-amber-500/20 text-amber-300',
  archived: 'bg-nina-line/40 border-nina-line text-nina-mute',
}

export default function Brands() {
  const { isJunta } = useAuth()
  const [brands, setBrands] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState({ open: false, brandId: null })
  const channelId = useId()

  const openCreate = () => setModal({ open: true, brandId: null })
  const openEdit = (id) => setModal({ open: true, brandId: id })
  const closeModal = () => setModal({ open: false, brandId: null })

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
      <>
        <EmptyState
          icon={Sparkles}
          title="Aún no hay marcas registradas"
          description="Las marcas son los universos que el CRM gestiona. Crea la primera para que su Brand Manager arranque a trabajar."
          actions={
            isJunta ? (
              <button onClick={openCreate} className="btn-primary text-sm">
                <Plus className="w-4 h-4" />
                Crear marca
              </button>
            ) : null
          }
        />
        <NewBrandModal open={modal.open} brandId={modal.brandId} onClose={closeModal} />
      </>
    )
  }

  return (
    <div className="space-y-5 lg:px-6 lg:pt-4">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-display text-2xl silver-text mb-1">Marcas del holding</h2>
          <p className="text-sm text-nina-mute">
            Cada marca tiene su propio Brand Manager y vive aislada del resto.
          </p>
        </div>
        {isJunta && (
          <button onClick={openCreate} className="btn-primary text-xs">
            <Plus className="w-3.5 h-3.5" />
            Nueva marca
          </button>
        )}
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {brands.map((b) => (
          <motion.div
            key={b.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="panel p-5 space-y-3 group relative"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="font-display text-2xl silver-text-static">{b.name}</div>
                <div className="text-[11px] uppercase tracking-[0.2em] text-nina-mute mt-0.5 font-mono">
                  {b.slug}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className={`chip ${STATUS_BADGE[b.status] ?? STATUS_BADGE.archived} text-[10px]`}>
                  {b.status}
                </span>
                {isJunta && (
                  <button
                    onClick={() => openEdit(b.id)}
                    className="p-1.5 rounded-md text-nina-mute hover:text-nina-chrome hover:bg-nina-line/40 transition opacity-0 group-hover:opacity-100"
                    title="Editar marca"
                    aria-label="Editar marca"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
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
            {b.market && (
              <div className="text-[11px] text-nina-mute">
                <span className="uppercase tracking-[0.18em] mr-1.5">Mercado:</span>
                {b.market}
              </div>
            )}
          </motion.div>
        ))}
      </div>

      <NewBrandModal open={modal.open} brandId={modal.brandId} onClose={closeModal} />
    </div>
  )
}
