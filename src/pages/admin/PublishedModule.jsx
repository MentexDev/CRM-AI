// Vista a PANTALLA COMPLETA de un módulo publicado. Monta EL MISMO viewer del canvas (SheetView,
// DocumentEditor, BoardView, SlideDeck) con los datos del snapshot → se ve y funciona idéntico a la
// pestaña (sin duplicar código). Es una foto: no se pasa onChange/getContentRef, así que las ediciones
// no se persisten; para guardar cambios, "Abrir en Code".
import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Download, Loader2, Sparkles, LayoutTemplate } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '../../lib/supabase'
import { artifactToFile } from '../../lib/artifactKinds'
import EmptyState from '../../components/EmptyState'
import SheetView from '../../components/SheetView'
import DocumentEditor from '../../components/DocumentEditor'
import BoardView from '../../components/BoardView'
import SlideDeck from '../../components/SlideDeck'

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

  const d = mod.data || {}

  const download = () => {
    const f = artifactToFile({ type: mod.kind, ...d, title: mod.title })
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

  // El MISMO componente que usa el canvas, con los datos del snapshot (sin onChange → no persiste).
  let viewer
  if (mod.kind === 'document') {
    viewer = <DocumentEditor title={mod.title} markdown={d.markdown ?? d.content} cover={d.cover} />
  } else if (mod.kind === 'slides') {
    viewer = <SlideDeck title={mod.title} subtitle={d.subtitle} slides={d.slides} theme={d.theme} />
  } else if (mod.kind === 'sheet') {
    viewer = <SheetView title={mod.title} columns={d.columns} rows={d.rows} sub={d.sub} />
  } else if (mod.kind === 'board') {
    viewer = <BoardView title={mod.title} nodes={d.nodes} edges={d.edges} />
  } else {
    viewer = <div className="p-6 text-nina-mute text-sm">Tipo de módulo no soportado.</div>
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="shrink-0 flex items-center justify-end gap-2 px-4 py-2 border-b border-nina-line/60">
        <button onClick={download} className="btn-ghost text-xs flex items-center gap-1.5">
          <Download className="w-3.5 h-3.5" /> Descargar
        </button>
        <button onClick={openInCode} className="btn-primary text-xs flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5" /> Abrir en Code
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">{viewer}</div>
    </div>
  )
}
