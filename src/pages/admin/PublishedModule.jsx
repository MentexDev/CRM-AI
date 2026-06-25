// Vista a PANTALLA COMPLETA (solo lectura) de un módulo publicado = una plantilla de Code publicada.
// El contenido se renderiza con el mismo renderer read-only de la galería (TemplateBody). Para EDITAR,
// el botón "Abrir en Code" lleva al chat del agente Code con esa pestaña/artefacto activo.
import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Download, Loader2, Sparkles, LayoutTemplate } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '../../lib/supabase'
import { artifactToFile, kindMeta } from '../../lib/artifactKinds'
import { TemplateBody } from '../../components/artifacts/TemplateRenderer'
import EmptyState from '../../components/EmptyState'

export default function PublishedModule() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [mod, setMod] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    ;(async () => {
      const { data, error } = await supabase
        .from('published_modules')
        .select('id, title, kind, data, source_conversation_id, source_artifact_key, created_at')
        .eq('id', id)
        .maybeSingle()
      if (!active) return
      if (error) console.error('[CRM-AI] published_module fetch:', error)
      setMod(data ?? null)
      setLoading(false)
    })()
    return () => {
      active = false
    }
  }, [id])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-nina-mute">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    )
  }
  if (!mod) {
    return (
      <div className="lg:px-6 lg:pt-4">
        <EmptyState icon={LayoutTemplate} title="Módulo no encontrado" description="Este módulo no existe o fue eliminado." />
      </div>
    )
  }

  const m = kindMeta(mod.kind)
  const Icon = m.Icon
  const t = { kind: mod.kind, data: mod.data || {}, title: mod.title }

  const download = () => {
    const f = artifactToFile({ type: mod.kind, ...(mod.data || {}), title: mod.title })
    if (f.url) {
      window.open(f.url, '_blank', 'noreferrer')
      return
    }
    const el = document.createElement('a')
    el.href = URL.createObjectURL(new Blob([f.text], { type: `${f.mime};charset=utf-8` }))
    el.download = f.name
    el.click()
    setTimeout(() => URL.revokeObjectURL(el.href), 1000)
    toast.success('Descargada')
  }

  const openInCode = () =>
    navigate(
      mod.source_conversation_id && mod.source_artifact_key
        ? `/admin/agentes/code?c=${mod.source_conversation_id}&tab=${encodeURIComponent(mod.source_artifact_key)}`
        : '/admin/agentes/code',
    )

  return (
    <div className="space-y-4 lg:px-6 lg:pt-4">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="font-display text-2xl silver-text truncate flex items-center gap-2">
            <Icon className={`w-5 h-5 ${m.color}`} /> {mod.title}
          </h1>
          <p className="text-[12.5px] text-nina-mute mt-0.5">Módulo publicado · {m.label} · solo lectura · para editar, ábrelo en Code</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={download} className="btn-ghost text-sm flex items-center gap-1.5"><Download className="w-4 h-4" /> Descargar</button>
          <button onClick={openInCode} className="btn-primary text-sm flex items-center gap-1.5"><Sparkles className="w-4 h-4" /> Abrir en Code</button>
        </div>
      </header>
      <div className="rounded-2xl border border-nina-line bg-nina-ink/30 p-6">
        <div className={mod.kind === 'document' ? 'max-w-3xl mx-auto' : ''}>
          <TemplateBody t={t} />
        </div>
      </div>
    </div>
  )
}
