import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'

// Renderiza el markdown que escriben los agentes (negrilla, cursiva, listas, enlaces,
// código, tablas). react-markdown NO interpreta HTML crudo por defecto → seguro contra
// inyección (cualquier <script> del modelo se muestra como texto, no se ejecuta).
// remark-breaks convierte saltos de línea simples en <br> (los agentes usan \n para
// separar líneas, como se veía antes con whitespace-pre-wrap).

const COMPONENTS = {
  p: ({ children }) => <p className="break-words">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  del: ({ children }) => <del className="opacity-70">{children}</del>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="underline underline-offset-2 hover:opacity-80"
    >
      {children}
    </a>
  ),
  ul: ({ children }) => <ul className="list-disc pl-5 space-y-0.5">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 space-y-0.5">{children}</ol>,
  li: ({ children }) => <li className="break-words">{children}</li>,
  h1: ({ children }) => <h3 className="font-semibold text-[1.05em] mt-1">{children}</h3>,
  h2: ({ children }) => <h3 className="font-semibold text-[1.03em] mt-1">{children}</h3>,
  h3: ({ children }) => <h4 className="font-semibold mt-1">{children}</h4>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-current/30 pl-3 opacity-90">{children}</blockquote>
  ),
  pre: ({ children }) => (
    <pre className="rounded-lg bg-black/25 p-3 my-1 overflow-x-auto text-[0.85em] font-mono">
      {children}
    </pre>
  ),
  code: ({ className, children }) => {
    // En react-markdown v10 el renderer de `code` no recibe `inline`: distinguimos un
    // bloque (con lenguaje o varias líneas) de código inline.
    const isBlock = /language-/.test(className || '') || /\n/.test(String(children))
    return isBlock ? (
      <code className={`font-mono ${className || ''}`}>{children}</code>
    ) : (
      <code className="rounded bg-black/15 px-1 py-0.5 text-[0.85em] font-mono">{children}</code>
    )
  },
  table: ({ children }) => (
    <div className="overflow-x-auto">
      <table className="text-[0.9em] border-collapse">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border border-current/20 px-2 py-1 text-left font-semibold">{children}</th>,
  td: ({ children }) => <td className="border border-current/20 px-2 py-1">{children}</td>,
}

export default function Markdown({ children, className = '' }) {
  return (
    <div className={`space-y-2 ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={COMPONENTS}>
        {children}
      </ReactMarkdown>
    </div>
  )
}
