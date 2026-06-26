// Vista a PANTALLA COMPLETA de un módulo publicado MULTI-SECCIÓN. Monta el viewer real de la sección
// activa (?section=<índice>); el MENÚ vive en el sidebar. FASE 3: edición en vivo COMPARTIDA — los
// viewers reciben onChange y los cambios se autoguardan (debounce) en published_modules.sections para
// todo el equipo. La sección "Resumen" se calcula sola (ModuleSummary) a partir de las hojas.
import { useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { Loader2, LayoutTemplate, Check, RefreshCw, AlertTriangle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { moduleSections } from '../../lib/publishedModules'
import EmptyState from '../../components/EmptyState'
import SheetView from '../../components/SheetView'
import DocumentEditor from '../../components/DocumentEditor'
import BoardView from '../../components/BoardView'
import SlideDeck from '../../components/SlideDeck'
import ModuleSummary from '../../components/artifacts/ModuleSummary'

// La sección Resumen se marca EXPLÍCITAMENTE con kind 'summary' (no por título) → no secuestra un
// documento titulado "Resumen…".
export function isSummarySection(section) {
  return section?.kind === 'summary'
}

function SectionViewer({ section, sections, onChange }) {
  const d = section?.data || {}
  if (isSummarySection(section)) return <ModuleSummary sections={sections} section={section} />
  if (section?.kind === 'document') return <DocumentEditor title={section.title} markdown={d.markdown ?? d.content} cover={d.cover} onChange={onChange} />
  if (section?.kind === 'slides') return <SlideDeck title={section.title} subtitle={d.subtitle} slides={d.slides} theme={d.theme} onChange={onChange} />
  if (section?.kind === 'sheet') return <SheetView title={section.title} columns={d.columns} rows={d.rows} sub={d.sub} onChange={onChange} />
  if (section?.kind === 'board') return <BoardView title={section.title} nodes={d.nodes} edges={d.edges} onChange={onChange} />
  return <div className="p-6 text-nina-mute text-sm">Sección no soportada.</div>
}

export default function PublishedModule() {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const [mod, setMod] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saveState, setSaveState] = useState('idle') // idle | saving | saved
  const sectionsRef = useRef([])
  const pendingRef = useRef(new Map()) // idx -> data pendiente de guardar (por sección)
  const timerRef = useRef(null)
  const hideTimerRef = useRef(null)
  const idRef = useRef(id)
  idRef.current = id

  useEffect(() => {
    let active = true
    setLoading(true)
    setSaveState('idle')
    dirtyRef.current = false
    ;(async () => {
      const { data, error } = await supabase.from('published_modules').select('id, title, kind, data, sections').eq('id', id).maybeSingle()
      if (!active) return
      if (error) console.error('[CRM-AI] published_module fetch:', error)
      setMod(data ?? null)
      sectionsRef.current = data ? moduleSections(data) : []
      setLoading(false)
    })()
    return () => {
      active = false
    }
  }, [id])

  // Guarda SÓLO las secciones editadas, cada una con la RPC update_module_section_data (toca su `data`,
  // no la autoría ni las otras secciones). Verifica que la RPC devolvió el id (si no, fue 0 filas/sin
  // permiso → muestra error en vez de un "Guardado" falso). Fire-and-forget con debounce.
  const flush = () => {
    const pend = pendingRef.current
    if (pend.size === 0) return
    const entries = [...pend.entries()]
    pendingRef.current = new Map()
    const mid = idRef.current
    setSaveState('saving')
    Promise.all(entries.map(([i, data]) => supabase.rpc('update_module_section_data', { p_id: mid, p_index: i, p_data: data }))).then((results) => {
      const failed = results.find((r) => r.error || !r.data)
      if (failed) {
        console.error('[CRM-AI] module autosave:', failed.error || 'no se afectó ninguna fila')
        setSaveState('error')
      } else {
        setSaveState('saved')
        clearTimeout(hideTimerRef.current)
        hideTimerRef.current = setTimeout(() => setSaveState('idle'), 1800)
      }
    })
  }

  // Guardar lo pendiente al salir del módulo o cambiar de id.
  useEffect(() => {
    return () => {
      clearTimeout(timerRef.current)
      clearTimeout(hideTimerRef.current)
      flush()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const sections = sectionsRef.current.length ? sectionsRef.current : moduleSections(mod)
  const raw = parseInt(searchParams.get('section') ?? '0', 10)
  const idx = Math.min(Math.max(0, Number.isFinite(raw) ? raw : 0), sections.length - 1)
  const section = sections[idx]
  const editable = !isSummarySection(section)

  const onSectionChange = (payload) => {
    sectionsRef.current = sectionsRef.current.map((s, i) => (i === idx ? { ...s, data: payload } : s))
    pendingRef.current.set(idx, payload)
    setSaveState('saving')
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(flush, 800)
  }

  return (
    <div className="relative h-full min-h-0 overflow-hidden">
      {editable && saveState !== 'idle' && (
        <div className={`absolute bottom-3 right-3 z-20 flex items-center gap-1.5 px-2 py-1 rounded-lg border text-[11px] shadow backdrop-blur-sm ${saveState === 'error' ? 'bg-red-500/15 border-red-400/40 text-red-200' : 'bg-nina-panel/90 border-nina-line text-nina-mute'}`}>
          {saveState === 'saving' ? (
            <>
              <RefreshCw className="w-3 h-3 animate-spin" /> Guardando…
            </>
          ) : saveState === 'error' ? (
            <>
              <AlertTriangle className="w-3 h-3" /> No se pudo guardar
            </>
          ) : (
            <>
              <Check className="w-3 h-3 text-emerald-300" /> Guardado
            </>
          )}
        </div>
      )}
      <SectionViewer key={idx} section={section} sections={sections} onChange={editable ? onSectionChange : undefined} />
    </div>
  )
}
