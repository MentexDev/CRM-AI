// Fuente ÚNICA de label/icono/color para los artefactos que un agente CREA, usada por las tarjetas
// del chat (progreso + resultado). Alineado con las peticiones del módulo Agentes del Notion:
// Documento, Slides, Sheets, Imagen, Correo, Video (+ Agenda/Pizarra que ya existen).
import {
  CalendarDays,
  FileText,
  Image as ImageIcon,
  LayoutGrid,
  Mail,
  Presentation,
  Table,
  Video,
} from 'lucide-react'

export const ARTIFACT_KIND = {
  document: { label: 'Documento', Icon: FileText, color: 'text-sky-300', dot: 'bg-sky-400' },
  slides: { label: 'Presentación', Icon: Presentation, color: 'text-amber-300', dot: 'bg-amber-400' },
  sheet: { label: 'Hoja de cálculo', Icon: Table, color: 'text-emerald-300', dot: 'bg-emerald-400' },
  image: { label: 'Imagen', Icon: ImageIcon, color: 'text-pink-300', dot: 'bg-pink-400' },
  email: { label: 'Correo', Icon: Mail, color: 'text-violet-300', dot: 'bg-violet-400' },
  video: { label: 'Video', Icon: Video, color: 'text-rose-300', dot: 'bg-rose-400' },
  calendar: { label: 'Agenda', Icon: CalendarDays, color: 'text-orange-300', dot: 'bg-orange-400' },
  board: { label: 'Pizarra', Icon: LayoutGrid, color: 'text-cyan-300', dot: 'bg-cyan-400' },
}

export const kindMeta = (k) => ARTIFACT_KIND[k] ?? { label: 'Archivo', Icon: FileText, color: 'text-nina-mute', dot: 'bg-nina-mute' }

export const wordCount = (s) => {
  const t = String(s || '').trim()
  return t ? t.split(/\s+/).length : 0
}

// Markdown → texto plano para el snippet de preview.
const stripMd = (s) =>
  String(s || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#*_`>~[\]()!|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const colName = (c) => (typeof c === 'string' ? c : c?.name ?? c?.label ?? '')

// Deriva la meta-línea ('· N palabras ·') y el snippet de un artefacto (estructura de canvasArtifacts).
export function artifactPreview(a) {
  switch (a?.type) {
    case 'document': {
      const wc = wordCount(a.markdown)
      return { meta: `${wc} palabra${wc === 1 ? '' : 's'}`, snippet: stripMd(a.markdown).slice(0, 200) }
    }
    case 'slides': {
      const n = Array.isArray(a.slides) ? a.slides.length : 0
      return { meta: `${n} diapositiva${n === 1 ? '' : 's'}`, snippet: a.subtitle || a.slides?.[0]?.title || '' }
    }
    case 'sheet': {
      const cols = Array.isArray(a.columns) ? a.columns.length : 0
      const rows = Array.isArray(a.rows) ? a.rows.length : 0
      return {
        meta: `${rows} fila${rows === 1 ? '' : 's'} × ${cols} columna${cols === 1 ? '' : 's'}`,
        snippet: (a.columns || []).map(colName).filter(Boolean).join(' · '),
      }
    }
    case 'image':
      return { meta: a.aspect ? `Imagen · ${a.aspect}` : 'Imagen', snippet: '' }
    case 'email':
      return { meta: 'Correo HTML', snippet: a.subject || '' }
    case 'calendar': {
      const n = Array.isArray(a.events) ? a.events.length : 0
      return { meta: `${n} evento${n === 1 ? '' : 's'}`, snippet: '' }
    }
    case 'board': {
      const n = Array.isArray(a.nodes) ? a.nodes.length : 0
      return { meta: `${n} nota${n === 1 ? '' : 's'}`, snippet: '' }
    }
    default:
      return { meta: '', snippet: '' }
  }
}

// Artefacto → archivo descargable. Devuelve {name,text,mime} (blob) o {name,url} (imagen, abre la URL).
export function artifactToFile(a) {
  const base =
    String(a?.title || a?.subject || kindMeta(a?.type).label || 'artefacto')
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .trim()
      .slice(0, 60) || 'artefacto'
  switch (a?.type) {
    case 'document':
      return { name: `${base}.md`, text: String(a.markdown || ''), mime: 'text/markdown' }
    case 'email':
      return { name: `${base}.html`, text: String(a.html || ''), mime: 'text/html' }
    case 'sheet': {
      const cols = (a.columns || []).map(colName)
      const esc = (v) => {
        const s = String(v ?? '')
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
      }
      const lines = [cols.map(esc).join(',')]
      for (const r of a.rows || []) {
        const arr = Array.isArray(r) ? r : cols.map((c, i) => r?.[c] ?? r?.[i] ?? '')
        lines.push(arr.map(esc).join(','))
      }
      return { name: `${base}.csv`, text: lines.join('\n'), mime: 'text/csv' }
    }
    case 'slides': {
      const body = (a.slides || [])
        .map((s, i) => {
          const t = s?.title || `Diapositiva ${i + 1}`
          const bullets = Array.isArray(s?.bullets)
            ? s.bullets.map((b) => `- ${b}`).join('\n')
            : String(s?.body || s?.content || '')
          return `## ${t}\n${bullets}`.trim()
        })
        .join('\n\n')
      return { name: `${base}.md`, text: `# ${a.title || 'Presentación'}\n\n${body}`, mime: 'text/markdown' }
    }
    case 'image':
      return { name: `${base}.png`, url: a.url }
    default:
      return { name: `${base}.json`, text: JSON.stringify(a, null, 2), mime: 'application/json' }
  }
}
