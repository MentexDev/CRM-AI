// Render READ-ONLY del contenido de una plantilla (document/sheet/board/slides), compartido por la
// galería "Plantillas Code" (Plantillas.jsx) y la vista a pantalla completa de un módulo publicado
// (PublishedModule.jsx). Recibe un objeto { kind, data, title } (mismo shape que code_templates /
// published_modules). NO edita: solo presenta.
import Markdown from '../Markdown'
import { kindMeta } from '../../lib/artifactKinds'

const colName = (c) => (typeof c === 'string' ? c : c?.name ?? c?.label ?? '')

// Texto plano de preview por tipo (búsqueda / tarjetas).
export function previewText(t) {
  const d = t?.data || {}
  if (t?.kind === 'document') return String(d.markdown || d.content || '').replace(/[#*`>_~[\]()|-]/g, ' ').replace(/\s+/g, ' ').trim()
  if (t?.kind === 'sheet') {
    const cols = (d.columns || []).map(colName).filter(Boolean)
    return [cols.join('  ·  '), ...(d.rows || []).slice(0, 4).map((r) => (Array.isArray(r) ? r : cols.map((c, i) => r?.[c] ?? r?.[i] ?? '')).join('  ·  '))].join('\n')
  }
  if (t?.kind === 'board') return (d.nodes || []).map((n) => n?.title || n?.label || n?.text || n?.heading).filter(Boolean).slice(0, 12).join('  ·  ')
  if (t?.kind === 'slides') return (d.slides || []).map((s) => s?.heading || s?.title).filter(Boolean).join('  ·  ')
  return ''
}

function Fallback({ t }) {
  const m = kindMeta(t?.kind)
  const Icon = m.Icon
  return <div className="grid place-items-center py-8"><Icon className={`w-8 h-8 ${m.color} opacity-70`} /></div>
}

// Render del contenido de la plantilla. Reutilizado por la tarjeta (mini, a escala) y el detalle/módulo.
export function TemplateBody({ t, mini }) {
  const d = t?.data || {}
  if (t?.kind === 'document') {
    const md = String(d.markdown || d.content || '')
    if (!md.trim()) return <Fallback t={t} />
    return <div className={`doc-prose ${mini ? 'text-[12px]' : 'text-sm'}`}><Markdown>{md}</Markdown></div>
  }
  if (t?.kind === 'sheet') return <SheetPreview d={d} />
  if (t?.kind === 'board') return <BoardPreview d={d} />
  if (t?.kind === 'slides') return <SlidesPreview d={d} />
  return <Fallback t={t} />
}

const PILL_PREVIEW = { gray: 'bg-nina-line/70 text-nina-chrome', blue: 'bg-blue-500/20 text-blue-200', green: 'bg-emerald-500/20 text-emerald-200', amber: 'bg-amber-500/20 text-amber-200', red: 'bg-red-500/20 text-red-200', purple: 'bg-violet-500/20 text-violet-200', pink: 'bg-pink-500/20 text-pink-200' }
const normCol = (c, i) => (typeof c === 'string' ? { name: c, type: 'text', options: [] } : { name: c?.name ?? `Columna ${i + 1}`, type: c?.type ?? 'text', options: c?.options ?? [] })
function cellView(c, v) {
  if (!v) return ''
  if (c.type === 'checkbox') return v === 'true' || v === '✓' ? '☑' : '☐'
  if (c.type === 'select') {
    const o = (c.options || []).find((x) => x.label === v)
    return <span className={`px-1.5 py-0.5 rounded-full text-[10.5px] ${PILL_PREVIEW[o?.color] || PILL_PREVIEW.gray}`}>{v}</span>
  }
  return v
}

function SheetPreview({ d }) {
  const cols = (d.columns || []).map(normCol)
  const rows = d.rows || []
  if (!cols.length) return <div className="text-nina-mute text-sm">Sin columnas.</div>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px] border-collapse">
        <thead>
          <tr>{cols.map((c, i) => <th key={i} className="text-left font-medium text-nina-chrome px-2 py-1.5 border-b border-nina-line">{c.name}</th>)}</tr>
        </thead>
        <tbody>
          {rows.slice(0, 200).map((r, ri) => (
            <tr key={ri} className="hover:bg-nina-line/20">
              {cols.map((c, ci) => <td key={ci} className="px-2 py-1.5 border-b border-nina-line/40 text-nina-mute">{cellView(c, String((Array.isArray(r) ? r[ci] : r?.[c.name] ?? r?.[ci]) ?? ''))}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function BoardPreview({ d }) {
  const nodes = d.nodes || []
  if (!nodes.length) return <div className="text-nina-mute text-sm">Sin tarjetas.</div>
  return (
    <div className="flex flex-wrap gap-2">
      {nodes.map((n, i) => (
        <div key={i} className="rounded-lg border border-nina-line bg-nina-panel/60 px-3 py-2 text-[12px] text-nina-chrome max-w-[220px]">
          <div className="font-medium truncate">{n?.title || n?.label || n?.heading || `Tarjeta ${i + 1}`}</div>
          {(n?.text || n?.body) && <div className="text-[11px] text-nina-mute line-clamp-3 mt-0.5">{n.text || n.body}</div>}
        </div>
      ))}
    </div>
  )
}

function SlidesPreview({ d }) {
  const slides = d.slides || []
  if (!slides.length) return <div className="text-nina-mute text-sm">Sin diapositivas.</div>
  // Honra el tema (fondo/colores) que el usuario configuró en Code, para que el módulo publicado
  // coincida con lo que ve en el canvas. Sin tema → estilo NINA por defecto.
  const theme = d.theme && typeof d.theme === 'object' ? d.theme : null
  return (
    <div className="space-y-2">
      {slides.map((s, i) => (
        <div
          key={i}
          style={theme ? { background: theme.background, color: theme.text } : undefined}
          className={`rounded-lg border px-3 py-2 ${theme ? 'border-black/10' : 'border-nina-line bg-nina-panel/50'}`}
        >
          <div className={`text-[13px] font-semibold ${theme ? '' : 'text-nina-chrome'}`} style={theme ? { color: theme.accent || theme.text } : undefined}>
            {s?.heading || s?.title || `Diapositiva ${i + 1}`}
          </div>
          {Array.isArray(s?.bullets) && s.bullets.length > 0 && (
            <ul className={`mt-1 space-y-0.5 text-[12px] list-disc pl-4 ${theme ? 'opacity-90' : 'text-nina-mute'}`}>
              {s.bullets.map((b, bi) => <li key={bi}>{b}</li>)}
            </ul>
          )}
          {(s?.body || s?.content) && <div className={`text-[12px] mt-1 ${theme ? 'opacity-90' : 'text-nina-mute'}`}>{s.body || s.content}</div>}
        </div>
      ))}
    </div>
  )
}
