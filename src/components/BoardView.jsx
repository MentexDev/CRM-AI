// Visor / editor de PIZARRAS (lienzo visual) — se monta como artefacto kind:'board' en el canvas
// (ArtifactCanvas). Notas (sticky) arrastrables y editables + conexiones dirigidas entre ellas.
// El usuario arrastra, edita texto, cambia color, conecta/desconecta, agrega/elimina notas y guarda.
// Tema oscuro NINA. Sin zoom (scroll nativo del lienzo) para evitar bugs de transformación.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link2, Pencil, Plus, Trash2, X } from 'lucide-react'

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
  const [editingId, setEditingId] = useState(null) // nota en modo edición (texto escribible + paleta)
  const editTextRef = useRef(null)
  // Al entrar en edición, enfoca el textarea y deja el cursor al final.
  useEffect(() => {
    if (editingId && editTextRef.current) {
      const el = editTextRef.current
      el.focus()
      const len = el.value.length
      el.setSelectionRange(len, len)
    }
  }, [editingId])

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
    if (editingId === node.id) return // en edición no se arrastra: se escribe/selecciona texto
    if (e.target.closest('[data-no-drag]')) return // botones/paleta: no arrastrar
    if (editingId) setEditingId(null) // agarrar otra nota cierra la edición previa
    e.preventDefault()
    dragRef.current = { id: node.id, sx: e.clientX, sy: e.clientY, ox: node.x, oy: node.y }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // ── Mutadores ────────────────────────────────────────────────────────────────
  const setNodeText = (id, text) => { setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, text } : n))); scheduleFire() }
  const setNodeColor = (id, color) => { setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, color } : n))); scheduleFire() }
  const toggleEdit = (id) => { setConnecting(false); setConnectFrom(null); setEditingId((cur) => (cur === id ? null : id)) }
  const removeNode = (id) => {
    setNodes((prev) => prev.filter((n) => n.id !== id))
    setEdges((prev) => prev.filter((e) => e.from !== id && e.to !== id))
    if (connectFrom === id) setConnectFrom(null)
    if (editingId === id) setEditingId(null)
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
  const toggleConnect = () => { setConnecting((v) => !v); setConnectFrom(null); setEditingId(null) }

  const scrollRef = useRef(null)

  // Geometría de conexiones estilo n8n: la flecha SALE/ENTRA por el BORDE del bloque (no por el
  // centro, que la haría pasar por encima de la nota) y la curva arranca perpendicular a esa cara.
  // anchor() = intersección del rayo centro→destino con el rectángulo de la nota + su normal.
  const anchor = (n, tx, ty) => {
    const cx = n.x + NW / 2
    const cy = n.y + NH / 2
    const dx = tx - cx
    const dy = ty - cy
    if (dx === 0 && dy === 0) return { x: cx, y: cy, nx: 0, ny: 0 }
    const sx = dx !== 0 ? NW / 2 / Math.abs(dx) : Infinity
    const sy = dy !== 0 ? NH / 2 / Math.abs(dy) : Infinity
    const sc = Math.min(sx, sy)
    const horiz = sx < sy // cae en la cara izquierda/derecha → normal horizontal
    return { x: cx + dx * sc, y: cy + dy * sc, nx: horiz ? Math.sign(dx) : 0, ny: horiz ? 0 : Math.sign(dy) }
  }
  // Devuelve el path (cubic bezier) y el punto medio aprox de una conexión a→b.
  const edgeGeom = (a, b) => {
    const ac = { x: a.x + NW / 2, y: a.y + NH / 2 }
    const bc = { x: b.x + NW / 2, y: b.y + NH / 2 }
    const s = anchor(a, bc.x, bc.y)
    const t = anchor(b, ac.x, ac.y)
    const k = Math.max(28, Math.hypot(t.x - s.x, t.y - s.y) * 0.4)
    const c1 = { x: s.x + s.nx * k, y: s.y + s.ny * k }
    const c2 = { x: t.x + t.nx * k, y: t.y + t.ny * k }
    // Bezier en u=0.5: (P0+P3)/8 + 3(P1+P2)/8.
    const mid = { x: 0.125 * (s.x + t.x) + 0.375 * (c1.x + c2.x), y: 0.125 * (s.y + t.y) + 0.375 * (c1.y + c2.y) }
    return { d: `M ${s.x} ${s.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${t.x} ${t.y}`, mid }
  }

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
        <div
          className="relative"
          style={{ width: bounds.w, height: bounds.h }}
          onPointerDown={(e) => { if (e.target === e.currentTarget) setEditingId(null) }}
        >
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
              const g = edgeGeom(a, b)
              return (
                <g key={i}>
                  <path d={g.d} fill="none" stroke="rgba(180,184,193,0.55)" strokeWidth="1.5" markerEnd="url(#nina-arrow)" />
                  {e.label && (
                    <text
                      x={g.mid.x}
                      y={g.mid.y - 4}
                      textAnchor="middle"
                      className="fill-nina-silver"
                      style={{ fontSize: 10, paintOrder: 'stroke', stroke: '#0d0e12', strokeWidth: 3, strokeLinejoin: 'round' }}
                    >
                      {e.label}
                    </text>
                  )}
                </g>
              )
            })}
          </svg>

          {/* Botones para eliminar conexión (capa HTML sobre el punto medio del bezier) */}
          {edges.map((e, i) => {
            const a = nodeById[e.from]
            const b = nodeById[e.to]
            if (!a || !b) return null
            const g = edgeGeom(a, b)
            return (
              <button
                key={`del-${i}`}
                onClick={() => removeEdge(i)}
                className="absolute z-10 w-4 h-4 grid place-items-center rounded-full bg-nina-panel border border-nina-line text-nina-mute hover:text-red-300 opacity-0 hover:opacity-100 transition"
                style={{ left: g.mid.x - 8, top: g.mid.y - 8 }}
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
            const isEditing = editingId === n.id && !connecting
            return (
              <div
                key={n.id}
                onPointerDown={(e) => onNodePointerDown(e, n)}
                className={`group absolute rounded-xl border shadow-lg ${c.bg} ${c.border} ${
                  connecting ? 'cursor-pointer' : isEditing ? 'cursor-text' : 'cursor-grab active:cursor-grabbing'
                } ${isFrom ? 'ring-2 ring-nina-silver' : isEditing ? 'ring-2 ring-nina-silver/70' : ''}`}
                style={{ left: n.x, top: n.y, width: NW, height: NH }}
              >
                <textarea
                  {...(isEditing ? { 'data-no-drag': true } : {})}
                  ref={isEditing ? editTextRef : null}
                  value={n.text}
                  onChange={(e) => setNodeText(n.id, e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Escape') setEditingId(null) }}
                  readOnly={!isEditing}
                  placeholder={isEditing ? 'Escribe…' : ''}
                  className={`w-full h-full resize-none bg-transparent px-2.5 py-2 text-[12px] leading-snug text-nina-chrome outline-none placeholder:text-nina-mute/40 ${
                    isEditing ? '' : 'pointer-events-none select-none'
                  }`}
                />
                {/* Controles arriba-derecha: ✎ editar (a la izquierda) + 🗑 eliminar. Siempre visibles
                    en edición; al pasar el cursor en el resto. */}
                <div data-no-drag className={`absolute -top-2.5 -right-2.5 flex items-center gap-1 transition ${isEditing ? '' : 'opacity-0 group-hover:opacity-100'}`}>
                  <button
                    onClick={() => toggleEdit(n.id)}
                    className={`w-4 h-4 grid place-items-center rounded-full border transition ${
                      isEditing ? 'bg-silver-gradient text-nina-black border-transparent' : 'bg-nina-panel border-nina-line text-nina-mute hover:text-nina-chrome'
                    }`}
                    title={isEditing ? 'Terminar edición' : 'Editar nota'}
                  >
                    <Pencil size={9} />
                  </button>
                  <button
                    onClick={() => removeNode(n.id)}
                    className="w-4 h-4 grid place-items-center rounded-full bg-nina-panel border border-nina-line text-nina-mute hover:text-red-300"
                    title="Eliminar nota"
                  >
                    <Trash2 size={9} />
                  </button>
                </div>
                {/* Paleta de color — se abre al editar */}
                {isEditing && (
                  <div data-no-drag className="absolute -bottom-9 left-0 z-20 flex items-center gap-1.5 rounded-lg border border-nina-line bg-nina-panel px-2 py-1.5 shadow-xl">
                    {COLOR_KEYS.map((ck) => (
                      <button
                        key={ck}
                        onClick={() => setNodeColor(n.id, ck)}
                        className={`w-4 h-4 rounded-full ${COLORS[ck].dot} ${n.color === ck ? 'ring-2 ring-nina-chrome ring-offset-1 ring-offset-nina-panel' : ''}`}
                        title={ck}
                      />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
