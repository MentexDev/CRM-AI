// Editor de documento estilo Notion (inspirado en NeuralOS) — TipTap v3.
// Núcleo: título editable, cuerpo con menú "/" para bloques, contador de palabras,
// export MD / PDF (ventana de impresión), toggle de ancho. Tema oscuro del CRM.
// Se monta como artefacto kind:'document' en el canvas (ArtifactCanvas).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Link from '@tiptap/extension-link'
import Highlight from '@tiptap/extension-highlight'
import { marked } from 'marked'
import TurndownService from 'turndown'
import {
  AlignCenter, AlignJustify, CheckSquare, Code, FileText, Heading1, Heading2,
  Heading3, List, ListOrdered, Minus, Printer, Quote, Type,
} from 'lucide-react'

// markdown ⇄ html. Init: md→html (TipTap parsea HTML). Export: html→md (turndown).
const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' })
turndown.addRule('taskItems', {
  filter: (node) => node.nodeName === 'LI' && node.getAttribute('data-type') === 'taskItem',
  replacement: (content, node) => `- [${node.getAttribute('data-checked') === 'true' ? 'x' : ' '}] ${content.trim()}\n`,
})
const mdToHtml = (md) => {
  try { return marked.parse(md || '', { breaks: true, gfm: true }) } catch { return md || '' }
}
const htmlToMd = (html) => {
  try { return turndown.turndown(html || '') } catch { return '' }
}

// Bloques del menú "/". `run` recibe un chain de TipTap ya enfocado.
const SLASH_ITEMS = [
  { id: 'text', label: 'Texto', icon: Type, kw: 'parrafo paragraph texto', run: (c) => c.setParagraph().run() },
  { id: 'h1', label: 'Título 1', icon: Heading1, kw: 'h1 heading titulo encabezado', run: (c) => c.toggleHeading({ level: 1 }).run() },
  { id: 'h2', label: 'Título 2', icon: Heading2, kw: 'h2 subtitulo', run: (c) => c.toggleHeading({ level: 2 }).run() },
  { id: 'h3', label: 'Título 3', icon: Heading3, kw: 'h3', run: (c) => c.toggleHeading({ level: 3 }).run() },
  { id: 'bullet', label: 'Lista', icon: List, kw: 'bullet vinetas lista', run: (c) => c.toggleBulletList().run() },
  { id: 'ordered', label: 'Lista numerada', icon: ListOrdered, kw: 'numbered ordenada numerada', run: (c) => c.toggleOrderedList().run() },
  { id: 'todo', label: 'Lista de tareas', icon: CheckSquare, kw: 'todo task checkbox tareas pendientes', run: (c) => c.toggleTaskList().run() },
  { id: 'quote', label: 'Cita', icon: Quote, kw: 'blockquote cita', run: (c) => c.toggleBlockquote().run() },
  { id: 'code', label: 'Código', icon: Code, kw: 'code codigo bloque', run: (c) => c.toggleCodeBlock().run() },
  { id: 'divider', label: 'Divisor', icon: Minus, kw: 'hr divider linea separador', run: (c) => c.setHorizontalRule().run() },
]

const DOC_CSS = `
.doc-prose { color: #c9cbd1; font-size: 15.5px; line-height: 1.7; }
.doc-prose:focus { outline: none; }
.doc-prose > * + * { margin-top: 0.6em; }
.doc-prose h1 { color: #f1f2f4; font-size: 1.7em; font-weight: 700; line-height: 1.25; margin-top: 1em; }
.doc-prose h2 { color: #eceef1; font-size: 1.35em; font-weight: 700; line-height: 1.3; margin-top: 0.9em; }
.doc-prose h3 { color: #e6e8ec; font-size: 1.12em; font-weight: 600; margin-top: 0.8em; }
.doc-prose strong { color: #eceef1; font-weight: 700; }
.doc-prose a { color: #8ab4ff; text-decoration: underline; text-underline-offset: 2px; }
.doc-prose ul, .doc-prose ol { padding-left: 1.4em; }
.doc-prose ul { list-style: disc; }
.doc-prose ol { list-style: decimal; }
.doc-prose li { margin: 0.2em 0; }
.doc-prose blockquote { border-left: 3px solid rgba(255,255,255,0.18); padding-left: 0.9em; color: #a6a9b2; font-style: italic; }
.doc-prose code { background: rgba(255,255,255,0.08); padding: 0.12em 0.4em; border-radius: 5px; font-size: 0.9em; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.doc-prose pre { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08); padding: 0.9em 1em; border-radius: 10px; overflow-x: auto; }
.doc-prose pre code { background: transparent; padding: 0; }
.doc-prose hr { border: none; border-top: 1px solid rgba(255,255,255,0.12); margin: 1.2em 0; }
.doc-prose ul[data-type="taskList"] { list-style: none; padding-left: 0.2em; }
.doc-prose ul[data-type="taskList"] li { display: flex; align-items: flex-start; gap: 0.5em; }
.doc-prose ul[data-type="taskList"] li > label { margin-top: 0.28em; }
.doc-prose ul[data-type="taskList"] input[type="checkbox"] { accent-color: #8ab4ff; }
.doc-prose mark { background: #d8b21255; color: inherit; border-radius: 3px; padding: 0 2px; }
.doc-prose p.is-editor-empty:first-child::before { content: attr(data-placeholder); color: rgba(255,255,255,0.25); float: left; height: 0; pointer-events: none; }
`

export default function DocumentEditor({ title: initialTitle, markdown, getContentRef }) {
  const [title, setTitle] = useState(initialTitle || 'Sin título')
  const [layoutFull, setLayoutFull] = useState(false)
  const [wordCount, setWordCount] = useState(0)
  const [slash, setSlash] = useState({ open: false, query: '', idx: 0, top: 0, left: 0 })

  const slashStartRef = useRef(null)
  const openRef = useRef(false)
  const idxRef = useRef(0)
  const filteredRef = useRef(SLASH_ITEMS)
  const openSlashRef = useRef(() => {})
  const execSlashRef = useRef(() => {})

  const filtered = useMemo(() => {
    const q = slash.query.trim().toLowerCase()
    return q ? SLASH_ITEMS.filter((i) => (i.label + ' ' + i.kw).toLowerCase().includes(q)) : SLASH_ITEMS
  }, [slash.query])
  filteredRef.current = filtered
  idxRef.current = slash.idx
  openRef.current = slash.open

  const closeSlash = useCallback(() => {
    slashStartRef.current = null
    setSlash((s) => ({ ...s, open: false, query: '', idx: 0 }))
  }, [])

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: "Escribe '/' para comandos, o solo empieza a escribir…" }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Link.configure({ openOnClick: false, autolink: true }),
      Highlight,
    ],
    content: mdToHtml(markdown),
    editorProps: {
      attributes: { class: 'doc-prose' },
      handleKeyDown(_view, event) {
        if (openRef.current) {
          if (event.key === 'ArrowDown') { setSlash((s) => ({ ...s, idx: Math.min(s.idx + 1, filteredRef.current.length - 1) })); return true }
          if (event.key === 'ArrowUp') { setSlash((s) => ({ ...s, idx: Math.max(s.idx - 1, 0) })); return true }
          if (event.key === 'Enter') { const it = filteredRef.current[idxRef.current]; if (it) execSlashRef.current(it); return true }
          if (event.key === 'Escape') { closeSlash(); return true }
        }
        if (event.key === '/') requestAnimationFrame(() => openSlashRef.current())
        return false
      },
    },
    onUpdate({ editor }) {
      setWordCount(editor.state.doc.textContent.trim().split(/\s+/).filter(Boolean).length)
      if (openRef.current) {
        const { from } = editor.state.selection
        const start = slashStartRef.current
        if (start == null || from < start) { closeSlash(); return }
        const text = editor.state.doc.textBetween(start, from, '\n', '\0')
        if (!text.startsWith('/')) { closeSlash(); return }
        setSlash((s) => ({ ...s, query: text.slice(1), idx: 0 }))
      }
    },
  })

  openSlashRef.current = () => {
    if (!editor) return
    const { from } = editor.state.selection
    const coords = editor.view.coordsAtPos(from)
    slashStartRef.current = from - 1 // posición del '/'
    setSlash({ open: true, query: '', idx: 0, top: coords.bottom + 6, left: coords.left })
  }
  execSlashRef.current = (item) => {
    if (!editor) return
    const { from } = editor.state.selection
    const start = slashStartRef.current ?? from
    editor.chain().focus().deleteRange({ from: start, to: from }).run()
    item.run(editor.chain().focus())
    closeSlash()
  }

  // Exponemos el contenido actual para que el "Guardar" del canvas lo lea on-demand.
  if (getContentRef) {
    getContentRef.current = () => ({ title, markdown: editor ? `# ${title}\n\n${htmlToMd(editor.getHTML())}` : (markdown || '') })
  }

  useEffect(() => {
    if (editor) setWordCount(editor.state.doc.textContent.trim().split(/\s+/).filter(Boolean).length)
  }, [editor])

  if (!editor) return null

  const exportMD = () => {
    const md = `# ${title}\n\n${htmlToMd(editor.getHTML())}`
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }))
    a.download = `${(title || 'documento').replace(/[^\w\- ]+/g, '').trim() || 'documento'}.md`
    a.click()
    URL.revokeObjectURL(a.href)
  }
  const exportPDF = () => {
    const w = window.open('', '_blank')
    if (!w) return
    const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
    w.document.write(
      `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>` +
        `body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;max-width:780px;margin:48px auto;padding:0 24px;color:#111;line-height:1.65}` +
        `h1,h2,h3{line-height:1.25}blockquote{border-left:3px solid #ddd;margin:0;padding-left:16px;color:#555}` +
        `code{background:#f3f3f3;padding:2px 5px;border-radius:4px;font-family:ui-monospace,Menlo,monospace}` +
        `pre{background:#f6f8fa;padding:14px;border-radius:8px;overflow:auto}img{max-width:100%}` +
        `ul[data-type="taskList"]{list-style:none;padding-left:0}` +
        `</style></head><body><h1>${esc(title)}</h1>${editor.getHTML()}</body></html>`,
    )
    w.document.close()
    w.focus()
    setTimeout(() => w.print(), 300)
  }

  const tbBtn = 'flex items-center gap-1 px-2 py-1 rounded-md text-[11.5px] text-nina-mute hover:text-nina-chrome hover:bg-nina-line/40 transition-colors'

  return (
    <div className="h-full flex flex-col bg-nina-ink">
      <style>{DOC_CSS}</style>
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-nina-line/50 shrink-0">
        <span className="text-[11.5px] text-nina-mute">{wordCount} {wordCount === 1 ? 'palabra' : 'palabras'}</span>
        <div className="flex items-center gap-1">
          <button onClick={exportMD} className={tbBtn} title="Descargar Markdown"><FileText size={13} /> MD</button>
          <button onClick={exportPDF} className={tbBtn} title="Imprimir / PDF"><Printer size={13} /> PDF</button>
          <button onClick={() => setLayoutFull((v) => !v)} className={tbBtn} title="Ancho">
            {layoutFull ? <AlignCenter size={13} /> : <AlignJustify size={13} />} Ancho
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="mx-auto px-6 py-7 transition-[max-width] duration-200" style={{ maxWidth: layoutFull ? '100%' : 780 }}>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Sin título"
            className="w-full bg-transparent text-nina-chrome text-[28px] font-bold outline-none placeholder:text-nina-mute/40 mb-2"
          />
          <EditorContent editor={editor} />
        </div>
      </div>
      {slash.open && filtered.length > 0 && (
        <div
          className="fixed z-50 w-60 max-h-72 overflow-y-auto rounded-xl border border-nina-line bg-nina-panel shadow-2xl py-1"
          style={{ top: slash.top, left: slash.left }}
        >
          {filtered.map((it, i) => {
            const Icon = it.icon
            return (
              <button
                key={it.id}
                onMouseDown={(e) => { e.preventDefault(); execSlashRef.current(it) }}
                onMouseEnter={() => setSlash((s) => ({ ...s, idx: i }))}
                className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-[13px] ${i === slash.idx ? 'bg-nina-line/40 text-nina-chrome' : 'text-nina-mute'}`}
              >
                <Icon size={15} className="shrink-0 opacity-80" /> {it.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
