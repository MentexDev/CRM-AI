// Vista a PANTALLA COMPLETA de un módulo publicado MULTI-SECCIÓN. Monta EL MISMO viewer del canvas
// (SheetView/DocumentEditor/BoardView/SlideDeck) para la sección activa (la elige ?section=<índice> en
// la URL; el MENÚ de secciones vive en el sidebar global — AdminLayout). Es una foto (sin onChange).
import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { Loader2, LayoutTemplate } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { moduleSections } from '../../lib/publishedModules'
import EmptyState from '../../components/EmptyState'
import SheetView from '../../components/SheetView'
import DocumentEditor from '../../components/DocumentEditor'
import BoardView from '../../components/BoardView'
import SlideDeck from '../../components/SlideDeck'

function SectionViewer({ section }) {
  const d = section?.data || {}
  if (section?.kind === 'document') return <DocumentEditor title={section.title} markdown={d.markdown ?? d.content} cover={d.cover} />
  if (section?.kind === 'slides') return <SlideDeck title={section.title} subtitle={d.subtitle} slides={d.slides} theme={d.theme} />
  if (section?.kind === 'sheet') return <SheetView title={section.title} columns={d.columns} rows={d.rows} sub={d.sub} />
  if (section?.kind === 'board') return <BoardView title={section.title} nodes={d.nodes} edges={d.edges} />
  return <div className="p-6 text-nina-mute text-sm">Sección no soportada.</div>
}

export default function PublishedModule() {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const [mod, setMod] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    ;(async () => {
      const { data, error } = await supabase
        .from('published_modules')
        .select('id, title, kind, data, sections')
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

  const sections = moduleSections(mod)
  const raw = parseInt(searchParams.get('section') ?? '0', 10)
  const idx = Math.min(Math.max(0, Number.isFinite(raw) ? raw : 0), sections.length - 1)
  const section = sections[idx] || sections[0]

  return (
    <div className="h-full min-h-0 overflow-hidden">
      <SectionViewer key={idx} section={section} />
    </div>
  )
}
