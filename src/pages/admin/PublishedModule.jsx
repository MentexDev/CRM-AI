// Vista a PANTALLA COMPLETA de un módulo publicado. Monta EL MISMO viewer del canvas (SheetView,
// DocumentEditor, BoardView, SlideDeck) con los datos del snapshot → se ve y funciona idéntico a la
// pestaña (sin duplicar código). Es una foto: sin onChange/getContentRef, las ediciones no se persisten.
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Loader2, LayoutTemplate } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import EmptyState from '../../components/EmptyState'
import SheetView from '../../components/SheetView'
import DocumentEditor from '../../components/DocumentEditor'
import BoardView from '../../components/BoardView'
import SlideDeck from '../../components/SlideDeck'

export default function PublishedModule() {
  const { id } = useParams()
  const [mod, setMod] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    ;(async () => {
      const { data, error } = await supabase
        .from('published_modules')
        .select('id, title, kind, data')
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

  return <div className="h-full min-h-0 overflow-hidden">{viewer}</div>
}
