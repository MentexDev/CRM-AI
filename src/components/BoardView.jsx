// Visor / editor de PIZARRAS (lienzo visual) — se monta como artefacto kind:'board' en el canvas
// (ArtifactCanvas). Notas (sticky) arrastrables y editables + conexiones dirigidas entre ellas.
// El usuario arrastra, edita texto, cambia color, conecta/desconecta, agrega/elimina notas y guarda.
// Tema oscuro NINA. Sin zoom (scroll nativo del lienzo) para evitar bugs de transformación.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link2, Plus, Trash2, X } from 'lucide-react'

// Tamaño fijo de cada nota (sticky) → anclas de las conexiones exactas (centro = x+W/2, y+H/2).
const NW = 184
const NH = 84
const PAD = 80 // margen del lienzo alrededor de las notas

// Paleta de colores de nota (clave → clases de fondo/borde/texto en tema oscuro).
const COLORS = {
  slate: { bg: 'bg-slate-500/15', border: 'border-slate-400/40', dot: 'bg-slate-400' },
  amber: { bg: 'bg-amber-500/15', border: 'border-amber-400/40', dot: 'bg-amber-400' },
  sky: { bg: 'bg-sky-500/15', border: 'border-sky-400/40', dot: 'bg-sky-400' },
  emerald: { bg: 'bg-emerald-500/15', border: 'border-emerald-400/40', dot: 'bg-emerald-400' },
  rose: { bg: 'bg-rose-500/15', border: 'border-rose-400/40', dot: 'bg-rose-400' },
  violet: { bg: 'bg-violet-500/15', border: 'border-violet-400/40', dot: 'bg-violet-400' },
}
const COLOR_KEYS = Object.keys(COLORS)

// Auto-layout en grilla para notas sin posición (el motor no obliga x/y; el modelo se enfoca en
// el contenido y las conexiones, y el frontend ubica; luego el usuario reordena arrastrando).
function withLayout(nodes) {
  const n = nodes.length
  const cols = Math.max(1, Math.ceil(Math.sqrt(n)))
  return nodes.map((nd, i) => {
    if (typeof nd.x === 'number' && typeof nd.y === 'number') return nd
    const col = i % cols
    const row = Math.floor(i / cols)
    return { ...nd, x: PAD + col * (NW + 56), y: PAD + row * (NH + 64) }
  })
}

export default function BoardView({ title: initialTitle, nodes: initialNodes, edges: initialEdges, getContentRef, onChange }) {
  const [title, setTitle] = useState(initialTitle || 'Pizarra')
  const [nodes, setNodes] = useState(() => withLayout((Array.isArray(initialNodes) ? initialNodes : []).map((n) => ({ color: 'slate', ...n }))))
  const [edges, setEdges] = useState(() => (Array.isArray(initialEdges) ? initialEdges : []))
  const [connectFrom, setConnectFrom] = useState(null) // id origen mientras se conecta (modo conectar)
  const [connecting, setConnecting] = useState(false)

  // Reporte de cambios (debounced) → el padre persiste (capa de overrides editedTabs) y limpia "guardado".
  const stateRef = useRef({ title, nodes, edges })
  stateRef.current = { title, nodes, edges }
  const fireTimer = useRef(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const scheduleFire = useCallback(() => {
    clearTimeout(fireTimer.current)
    fireTimer.current = setTimeout(() => onChangeRef.current?.(stateRef.current), 400)
  }, [])
  useEffect(() => () => { clearTimeout(fireTimer.current); onChangeRef.current?.(stateRef.current) }, [])

  if (getContentRef) getContentRef.current = () => ({ title, nodes, edges })

  const nodeById = useMemo(() => Object.fromEntries(nodes.map((n) => [n.id, n])), [nodes])

  // Límites del lienzo (para dimensionar el área scrollable y el SVG de conexiones).
  const bounds = useMemo(() => {
    let w = 900
    let h = 600
    for (const n of nodes) { w = Math.max(w, n.x + NW + PAD); h = Math.max(h, n.y + NH + PAD) }
    return { w, h }
  }, [nodes])

  // ── Arrastre de notas (pointer events + listeners de window) ─────────────────
  const dragRef = useRef(null)
  const onMove = useCallback((e) => {
    const d = dragRef.current
    if (!d) return
    const dx = e.clientX - d.sx
    const dy = e.clientY - d.sy
    setNodes((prev) => prev.map((n) => (n.id === d.id ? { ...n, x: Math.max(0, d.ox + dx), y: Math.max(0, d.oy + dy) } : n)))
  }, [])
  const onUp = useCallback(() => {
    dragRef.current = null
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    scheduleFire()
  }, [onMove, scheduleFire])
  // Limpieza defensiva si se desmonta a mitad de un arrastre.
  useEffect(() => () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }, [onMove, onUp])

  const onNodePointerDown = (e, node) => {
    if (connecting) { handleConnectClick(node.id); return }
    if (e.target.closest('[data-no-drag]')) return // texto/botones: no arrastrar
    e.preventDefault()
    dragRef.current = { id: node.id, sx: e.clientX, sy: e.clientY, ox: node.x, oy: node.y }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // ── Mutadores ────────────────────────────────────────────────────────────────
  const setNodeText = (id, text) => { setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, text } : n))); scheduleFire() }
  const cycleColor = (id) => {
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, color: COLOR_KEYS[(COLOR_KEYS.indexOf(n.color) + 1) % COLOR_KEYS.length] } : n)))
    scheduleFire()
  }
  const removeNode = (id) => {
    setNodes((prev) => prev.filter((n) => n.id !== id))
    setEdges((prev) => prev.filter((e) => e.from !== id && e.to !== id))
    if (connectFrom === id) setConnectFrom(null)
    scheduleFire()
  }
  const addNode = () => {
    const id = `n${Date.now().toString(36)}`
    // Lo ubicamos cerca de la esquina visible del lienzo (scroll actual).
    const sc = scrollRef.current
    const x = (sc?.scrollLeft ?? 0) + 60
    const y = (sc?.scrollTop ?? 0) + 60
    setNodes((prev) => [...prev, { id, text: '', color: 'slate', x, y }])
    scheduleFire()
  }
  const removeEdge = (idx) => { setEdges((prev) => prev.filter((_, i) => i !== idx)); scheduleFire() }
  const handleConnectClick = (id) => {
    if (!connectFrom) { setConnectFrom(id); return }
    if (connectFrom === id) { setConnectFrom(null); return }
    setEdges((prev) => (prev.some((e) => e.from === connectFrom && e.to === id) ? prev : [...prev, { from: connectFrom, to: id }]))
    setConnectFrom(null)
    scheduleFire()
  }
  const toggleConnect = () => { setConnecting((v) => !v); setConnectFrom(null) }

  const scrollRef = useRef(null)

  // Centro de una nota (ancla de conexión).
  const center = (n) => ({ x: n.x + NW / 2, y: n.y + NH / 2 })

  return (
    <div className="h-full flex flex-col bg-nina-ink">
      {/* Barra superior: título + acciones */}
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-nina-line/50 shrink-0">
        <input
          value={title}
          onChange={(e) => { setTitle(e.target.value); scheduleFire() }}
          placeholder="Título de la pizarra"
          className="min-w-0 flex-1 bg-transparent text-nina-chrome text-[13px] font-medium outline-none placeholder:text-nina-mute/40"
        />
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-[11px] text-nina-mute px-1">{nodes.length} notas</span>
          <button
            onClick={toggleConnect}
            className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11.5px] transition ${
              connecting ? 'bg-silver-gradient text-nina-black' : 'text-nina-mute hover:text-nina-chrome hover:bg-nina-line/40'
            }`}
            title="Conectar notas: clic en la nota origen y luego en la destino"
          >
            <Link2 size={13} /> Conectar
          </button>
          <button onClick={addNode} className="flex items-center gap-1 px-2 py-1 rounded-md text-[11.5px] text-nina-mute hover:text-nina-chrome hover:bg-nina-line/40 transition" title="Agregar nota">
            <Plus size={13} /> Nota
          </button>
        </div>
      </div>

      {/* Banner del modo conectar */}
      {connecting && (
        <div className="px-3 py-1.5 text-[11.5px] text-nina-silver bg-nina-line/20 border-b border-nina-line/40 shrink-0">
          {connectFrom ? 'Ahora haz clic en la nota destino…' : 'Modo conectar: haz clic en la nota de origen.'}
          <button onClick={toggleConnect} className="ml-2 text-nina-mute hover:text-nina-chrome underline">salir</button>
        </div>
      )}

      {/* Lienzo scrollable */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto relative" style={{ backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.05) 1px, transparent 1px)', backgroundSize: '22px 22px' }}>
        <div className="relative" style={{ width: bounds.w, height: bounds.h }}>
          {/* Conexiones (SVG detrás de las notas) */}
          <svg className="absolute inset-0 pointer-events-none" width={bounds.w} height={bounds.h}>
            <defs>
              <marker id="nina-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(180,184,193,0.7)" />
              </marker>
            </defs>
            {edges.map((e, i) => {
              const a = nodeById[e.from]
              const b = nodeById[e.to]
              if (!a || !b) return null
              const ca = center(a)
              const cb = center(b)
              return (
                <g key={i}>
                  <line x1={ca.x} y1={ca.y} x2={cb.x} y2={cb.y} stroke="rgba(180,184,193,0.5)" strokeWidth="1.5" markerEnd="url(#nina-arrow)" />
                  {e.label && (
                    <text x={(ca.x + cb.x) / 2} y={(ca.y + cb.y) / 2 - 4} textAnchor="middle" className="fill-nina-mute" style={{ fontSize: 10 }}>
                      {e.label}
                    </text>
                  )}
                </g>
              )
            })}
          </svg>

          {/* Botones para eliminar conexión (capa HTML sobre el punto medio) */}
          {edges.map((e, i) => {
            const a = nodeById[e.from]
            const b = nodeById[e.to]
            if (!a || !b) return null
            const mx = (a.x + b.x) / 2 + NW / 2
            const my = (a.y + b.y) / 2 + NH / 2
            return (
              <button
                key={`del-${i}`}
                onClick={() => removeEdge(i)}
                className="absolute z-10 w-4 h-4 grid place-items-center rounded-full bg-nina-panel border border-nina-line text-nina-mute hover:text-red-300 opacity-0 hover:opacity-100 transition"
                style={{ left: mx - 8, top: my - 8 }}
                title="Eliminar conexión"
              >
                <X size={10} />
              </button>
            )
          })}

          {/* Notas */}
          {nodes.map((n) => {
            const c = COLORS[n.color] || COLORS.slate
            const isFrom = connectFrom === n.id
            return (
              <div
                key={n.id}
                onPointerDown={(e) => onNodePointerDown(e, n)}
                className={`group absolute rounded-xl border shadow-lg select-none ${c.bg} ${c.border} ${
                  connecting ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'
                } ${isFrom ? 'ring-2 ring-nina-silver' : ''}`}
                style={{ left: n.x, top: n.y, width: NW, height: NH }}
              >
                <textarea
                  data-no-drag
                  value={n.text}
                  onChange={(e) => setNodeText(n.id, e.target.value)}
                  readOnly={connecting}
                  placeholder="Escribe…"
                  className="w-full h-full resize-none bg-transparent px-2.5 py-2 text-[12px] leading-snug text-nina-chrome outline-none placeholder:text-nina-mute/40"
                />
                {/* Controles (aparecen al hover) */}
                <div data-no-drag className="absolute -top-2.5 -right-2.5 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                  <button
                    onClick={() => cycleColor(n.id)}
                    className={`w-4 h-4 rounded-full border border-nina-panel ${c.dot}`}
                    title="Cambiar color"
                  />
                  <button
                    onClick={() => removeNode(n.id)}
                    className="w-4 h-4 grid place-items-center rounded-full bg-nina-panel border border-nina-line text-nina-mute hover:text-red-300"
                    title="Eliminar nota"
                  >
                    <Trash2 size={9} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
