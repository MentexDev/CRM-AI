// Visor / editor de HOJAS DE CÁLCULO tipo base de datos de Notion — artefacto kind:'sheet' del canvas.
// Columnas TIPADAS: Texto, Estado/Selección (opciones con color), Fecha, Número, Casilla. Render por tipo,
// selector de tipo al crear/cambiar columna, agregar/eliminar filas y columnas, totales numéricos y CSV.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Calculator, Calendar, Check, CheckSquare, ChevronDown, Download, Hash, Plus, Tag, Trash2, Type, X } from 'lucide-react'
import toast from 'react-hot-toast'

function parseNum(v) {
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (!s) return null
  const cleaned = s.replace(/[$\s%]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(/,/g, '.')
  if (!/^-?\d*\.?\d+$/.test(cleaned)) return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

// Tipos de columna (estilo Notion) + su icono.
const TYPE_META = {
  text: { label: 'Texto', icon: Type },
  select: { label: 'Estado / Selección', icon: Tag },
  date: { label: 'Fecha', icon: Calendar },
  number: { label: 'Número', icon: Hash },
  checkbox: { label: 'Casilla', icon: CheckSquare },
}
const TYPE_KEYS = ['text', 'select', 'date', 'number', 'checkbox']

// Colores de las opciones de Estado/Selección.
const PILL = {
  gray: 'bg-nina-line/70 text-nina-chrome border-nina-line',
  blue: 'bg-blue-500/20 text-blue-200 border-blue-500/30',
  green: 'bg-emerald-500/20 text-emerald-200 border-emerald-500/30',
  amber: 'bg-amber-500/20 text-amber-200 border-amber-500/30',
  red: 'bg-red-500/20 text-red-200 border-red-500/30',
  purple: 'bg-violet-500/20 text-violet-200 border-violet-500/30',
  pink: 'bg-pink-500/20 text-pink-200 border-pink-500/30',
}
const PILL_KEYS = ['gray', 'blue', 'green', 'amber', 'red', 'purple', 'pink']

const normCol = (c, i) => {
  if (typeof c === 'string' || typeof c === 'number') return { name: String(c), type: 'text', options: [] }
  const type = TYPE_META[c?.type] ? c.type : 'text'
  const options = Array.isArray(c?.options)
    ? c.options.map((o) => (typeof o === 'string' ? { label: o, color: 'gray' } : { label: String(o?.label ?? ''), color: PILL[o?.color] ? o.color : 'gray' }))
    : []
  return { name: String(c?.name ?? `Columna ${i + 1}`), type, options }
}

export default function SheetView({ title: initialTitle, columns: initialColumns, rows: initialRows, getContentRef, onChange }) {
  const [title, setTitle] = useState(initialTitle || 'Hoja de cálculo')
  const [columns, setColumns] = useState(() => {
    const cs = Array.isArray(initialColumns) && initialColumns.length ? initialColumns : ['Columna 1']
    return cs.map(normCol)
  })
  const [rows, setRows] = useState(() => {
    const cols = columnsLen(initialColumns)
    const r = Array.isArray(initialRows) ? initialRows : []
    const norm = r.map((row) => Array.from({ length: cols }, (_, i) => (Array.isArray(row) ? String(row[i] ?? '') : '')))
    return norm.length ? norm : [Array.from({ length: cols }, () => '')]
  })
  const [showTotals, setShowTotals] = useState(true)
  const [colMenu, setColMenu] = useState(null) // índice de columna con menú abierto
  const scrollRef = useRef(null) // grilla scrollable → auto-scroll a la derecha al agregar columna

  const stateRef = useRef({ title, columns, rows })
  stateRef.current = { title, columns, rows }
  const fireTimer = useRef(null)
  const dirtyRef = useRef(false)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const scheduleFire = useCallback(() => {
    dirtyRef.current = true
    clearTimeout(fireTimer.current)
    fireTimer.current = setTimeout(() => onChangeRef.current?.(stateRef.current), 400)
  }, [])
  useEffect(() => () => { clearTimeout(fireTimer.current); if (dirtyRef.current) onChangeRef.current?.(stateRef.current) }, [])

  if (getContentRef) getContentRef.current = () => ({ title, columns, rows })

  // ── Mutadores ──────────────────────────────────────────────────────────────
  const setCell = (ri, ci, val) => { setRows((prev) => prev.map((r, i) => (i === ri ? r.map((c, j) => (j === ci ? val : c)) : r))); scheduleFire() }
  const setColName = (ci, val) => { setColumns((prev) => prev.map((c, i) => (i === ci ? { ...c, name: val } : c))); scheduleFire() }
  const setColType = (ci, type) => { setColumns((prev) => prev.map((c, i) => (i === ci ? { ...c, type } : c))); scheduleFire() }
  // Agrega una opción nueva a una columna select (color rotativo) si no existe.
  const ensureOption = (ci, label) => {
    setColumns((prev) => prev.map((c, i) => {
      if (i !== ci || c.type !== 'select') return c
      if (!label || c.options.some((o) => o.label === label)) return c
      const color = PILL_KEYS[c.options.length % PILL_KEYS.length]
      return { ...c, options: [...c.options, { label, color }] }
    }))
  }
  const addRow = () => { setRows((prev) => [...prev, columns.map(() => '')]); scheduleFire() }
  const removeRow = (ri) => { setRows((prev) => (prev.length <= 1 ? [columns.map(() => '')] : prev.filter((_, i) => i !== ri))); scheduleFire() }
  const addColumn = (type = 'text') => {
    setColumns((prev) => [...prev, { name: `${TYPE_META[type]?.label || 'Columna'} ${prev.length + 1}`, type, options: [] }])
    setRows((prev) => prev.map((r) => [...r, '']))
    scheduleFire()
    // Auto-scroll a la derecha → la nueva columna y el "+" quedan visibles sin mover la barra a mano.
    requestAnimationFrame(() => { const el = scrollRef.current; if (el) el.scrollTo({ left: el.scrollWidth, behavior: 'smooth' }) })
  }
  const removeColumn = (ci) => {
    if (columns.length <= 1) return
    setColumns((prev) => prev.filter((_, i) => i !== ci))
    setRows((prev) => prev.map((r) => r.filter((_, i) => i !== ci)))
    setColMenu(null)
    scheduleFire()
  }

  // Totales: solo columnas numéricas (type number, o text 100% numérico).
  const totals = useMemo(() => columns.map((col, ci) => {
    if (col.type !== 'number' && col.type !== 'text') return null
    let sum = 0, count = 0
    for (const r of rows) {
      const raw = r[ci]
      if (typeof raw !== 'string' || raw.trim() === '') continue
      const n = parseNum(raw)
      if (n == null) return null
      sum += n; count++
    }
    return count ? sum : null
  }), [columns, rows])

  const fmtTotal = (n) => (n == null ? '' : (Math.round(n * 100) / 100).toLocaleString('es-CO', { maximumFractionDigits: 2 }))

  const exportCSV = () => {
    const esc = (s) => { const v = String(s ?? ''); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v }
    const lines = [columns.map((c) => esc(c.name)).join(','), ...rows.map((r) => r.map(esc).join(','))]
    const csv = '﻿' + lines.join('\r\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    a.download = `${(title || 'hoja').replace(/[^\w\- ]+/g, '').trim() || 'hoja'}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
    toast.success('CSV descargado')
  }

  return (
    <div className="h-full flex flex-col bg-nina-ink">
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-nina-line/50 shrink-0">
        <input
          value={title}
          onChange={(e) => { setTitle(e.target.value); scheduleFire() }}
          placeholder="Título de la hoja"
          className="min-w-0 flex-1 bg-transparent text-nina-chrome text-[13px] font-medium outline-none placeholder:text-nina-mute/40"
        />
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-[11px] text-nina-mute px-1">{rows.length}×{columns.length}</span>
          <button onClick={() => setShowTotals((v) => !v)} className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11.5px] transition ${showTotals ? 'bg-silver-gradient text-nina-black' : 'text-nina-mute hover:text-nina-chrome hover:bg-nina-line/40'}`} title="Mostrar/ocultar totales">
            <Calculator size={13} /> Totales
          </button>
          <button onClick={exportCSV} className="flex items-center gap-1 px-2 py-1 rounded-md text-[11.5px] text-nina-mute hover:text-nina-chrome hover:bg-nina-line/40 transition" title="Descargar CSV">
            <Download size={13} /> CSV
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto">
        <div className="inline-block min-w-full pr-3 align-top">
        <table className="border-collapse">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className="sticky left-0 z-20 bg-nina-panel border-b border-r border-nina-line/60 w-9" />
              {columns.map((col, ci) => {
                const TIcon = TYPE_META[col.type]?.icon || Type
                return (
                  <th key={ci} className="group bg-nina-panel border-b border-r border-nina-line/60 min-w-[140px] text-left relative">
                    <div className="flex items-center">
                      <button onClick={() => setColMenu(colMenu === ci ? null : ci)} className="pl-2 pr-1 py-1.5 text-nina-mute hover:text-nina-chrome shrink-0" title={`Tipo: ${TYPE_META[col.type]?.label}`}>
                        <TIcon size={12.5} />
                      </button>
                      <input
                        value={col.name}
                        onChange={(e) => setColName(ci, e.target.value)}
                        placeholder={`Columna ${ci + 1}`}
                        className="w-full bg-transparent pr-2 py-1.5 text-[12px] font-semibold text-nina-chrome outline-none focus:bg-nina-line/30 placeholder:text-nina-mute/40"
                      />
                      <button onClick={() => removeColumn(ci)} disabled={columns.length <= 1} className="px-1 opacity-0 group-hover:opacity-100 text-nina-mute hover:text-red-300 disabled:opacity-0 transition shrink-0" title="Eliminar columna">
                        <Trash2 size={12} />
                      </button>
                    </div>
                    {colMenu === ci && (
                      <ColumnMenu col={col} onType={(t) => { setColType(ci, t); setColMenu(null) }} onClose={() => setColMenu(null)} />
                    )}
                  </th>
                )
              })}
              <th className="bg-nina-panel border-b border-nina-line/60 w-9 relative">
                <AddColumnButton onAdd={addColumn} />
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri} className="group">
                <td className="sticky left-0 z-10 bg-nina-ink border-b border-r border-nina-line/40 text-center align-middle">
                  <div className="relative w-9 h-full grid place-items-center">
                    <span className="text-[10px] text-nina-mute group-hover:opacity-0">{ri + 1}</span>
                    <button onClick={() => removeRow(ri)} className="absolute inset-0 grid place-items-center opacity-0 group-hover:opacity-100 text-nina-mute hover:text-red-300 transition" title="Eliminar fila">
                      <Trash2 size={12} />
                    </button>
                  </div>
                </td>
                {columns.map((col, ci) => (
                  <td key={ci} className="border-b border-r border-nina-line/40 p-0 align-middle">
                    <Cell col={col} value={r[ci] ?? ''} onChange={(v) => setCell(ri, ci, v)} onEnsureOption={(label) => ensureOption(ci, label)} />
                  </td>
                ))}
                <td className="border-b border-nina-line/40" />
              </tr>
            ))}
          </tbody>
          {showTotals && (
            <tfoot className="sticky bottom-0 z-10">
              <tr>
                <td className="sticky left-0 z-20 bg-nina-panel border-t border-r border-nina-line/60 text-center text-[9px] uppercase tracking-wide text-nina-mute py-1.5">Σ</td>
                {totals.map((t, ci) => (
                  <td key={ci} className="bg-nina-panel border-t border-r border-nina-line/60 px-2 py-1.5 text-right text-[12.5px] font-semibold text-nina-chrome tabular-nums">{fmtTotal(t)}</td>
                ))}
                <td className="bg-nina-panel border-t border-nina-line/60" />
              </tr>
            </tfoot>
          )}
        </table>
        <button onClick={addRow} className="flex items-center gap-1.5 px-3 py-2 text-[12px] text-nina-mute hover:text-nina-chrome transition">
          <Plus size={13} /> fila
        </button>
        </div>
      </div>
    </div>
  )
}

function columnsLen(cols) {
  return Array.isArray(cols) && cols.length ? cols.length : 1
}

// ── Celda según el tipo de columna ─────────────────────────────────────────────
const cellCls = 'w-full bg-transparent px-2 py-1.5 text-[12.5px] text-nina-chrome/90 outline-none focus:bg-nina-line/30 transition'

function Cell({ col, value, onChange, onEnsureOption }) {
  if (col.type === 'checkbox') {
    return (
      <div className="grid place-items-center py-1.5">
        <input type="checkbox" checked={value === 'true' || value === '✓'} onChange={(e) => onChange(e.target.checked ? 'true' : '')} className="w-3.5 h-3.5 accent-[#8ab4ff] cursor-pointer" />
      </div>
    )
  }
  if (col.type === 'date') {
    return <input type="date" value={/^\d{4}-\d{2}-\d{2}$/.test(value) ? value : ''} onChange={(e) => onChange(e.target.value)} className={`${cellCls} [color-scheme:dark]`} />
  }
  if (col.type === 'number') {
    return <input value={value} onChange={(e) => onChange(e.target.value)} inputMode="decimal" className={`${cellCls} text-right tabular-nums`} />
  }
  if (col.type === 'select') {
    return <SelectCell col={col} value={value} onChange={onChange} onEnsureOption={onEnsureOption} />
  }
  return <input value={value} onChange={(e) => onChange(e.target.value)} className={`${cellCls} ${parseNum(value) != null ? 'text-right tabular-nums' : ''}`} />
}

function SelectCell({ col, value, onChange, onEnsureOption }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const opt = col.options.find((o) => o.label === value)
  const pick = (label) => { onEnsureOption(label); onChange(label); setOpen(false); setDraft('') }
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-1 px-2 py-1.5 min-h-[31px] text-left hover:bg-nina-line/20 transition">
        {value ? (
          <span className={`px-2 py-0.5 rounded-full text-[11px] border ${PILL[opt?.color] || PILL.gray}`}>{value}</span>
        ) : (
          <span className="text-[12px] text-nina-mute/40">—</span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute z-30 top-full left-1 mt-0.5 w-44 rounded-lg border border-nina-line bg-nina-panel shadow-xl p-1.5">
            <div className="max-h-44 overflow-y-auto space-y-0.5">
              {col.options.map((o) => (
                <button key={o.label} onClick={() => pick(o.label)} className="w-full flex items-center justify-between gap-1 px-1.5 py-1 rounded-md hover:bg-nina-line/40 transition">
                  <span className={`px-2 py-0.5 rounded-full text-[11px] border ${PILL[o.color] || PILL.gray}`}>{o.label}</span>
                  {o.label === value && <Check size={12} className="text-nina-chrome shrink-0" />}
                </button>
              ))}
              {value && (
                <button onClick={() => { onChange(''); setOpen(false) }} className="w-full flex items-center gap-1.5 px-1.5 py-1 rounded-md text-[11.5px] text-nina-mute hover:text-nina-chrome hover:bg-nina-line/40 transition">
                  <X size={12} /> Quitar
                </button>
              )}
            </div>
            <div className="flex items-center gap-1 mt-1 pt-1 border-t border-nina-line/50">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && draft.trim()) pick(draft.trim()) }}
                placeholder="Nueva opción…"
                className="flex-1 bg-nina-ink border border-nina-line rounded-md px-1.5 py-1 text-[11.5px] text-nina-chrome placeholder:text-nina-mute/50 outline-none"
              />
              <button onClick={() => draft.trim() && pick(draft.trim())} className="px-1.5 py-1 rounded-md bg-silver-gradient text-nina-black"><Plus size={12} /></button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// Menú del encabezado: cambiar el TIPO de la columna.
function ColumnMenu({ col, onType, onClose }) {
  return (
    <>
      <div className="fixed inset-0 z-20" onClick={onClose} />
      <div className="absolute z-30 top-full left-1 mt-0.5 w-52 rounded-lg border border-nina-line bg-nina-panel shadow-xl p-1.5">
        <div className="text-[10px] uppercase tracking-wide text-nina-mute px-1.5 pb-1">Tipo de columna</div>
        {TYPE_KEYS.map((t) => {
          const Icon = TYPE_META[t].icon
          return (
            <button key={t} onClick={() => onType(t)} className={`w-full flex items-center gap-2 px-1.5 py-1.5 rounded-md text-[12.5px] transition ${col.type === t ? 'bg-nina-line/50 text-nina-chrome' : 'text-nina-mute hover:text-nina-chrome hover:bg-nina-line/30'}`}>
              <Icon size={13} className="shrink-0" />
              <span className="flex-1 text-left">{TYPE_META[t].label}</span>
              {col.type === t && <Check size={12} className="shrink-0" />}
            </button>
          )
        })}
      </div>
    </>
  )
}

// Botón "+" del encabezado: elige el TIPO de la nueva columna (estilo Notion).
function AddColumnButton({ onAdd }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen((o) => !o)} className="w-full h-full grid place-items-center text-nina-mute hover:text-nina-chrome py-1.5" title="Agregar columna">
        <Plus size={14} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute z-30 top-full right-0 mt-0.5 w-52 rounded-lg border border-nina-line bg-nina-panel shadow-xl p-1.5">
            <div className="text-[10px] uppercase tracking-wide text-nina-mute px-1.5 pb-1">Nueva columna</div>
            {TYPE_KEYS.map((t) => {
              const Icon = TYPE_META[t].icon
              return (
                <button key={t} onClick={() => { onAdd(t); setOpen(false) }} className="w-full flex items-center gap-2 px-1.5 py-1.5 rounded-md text-[12.5px] text-nina-mute hover:text-nina-chrome hover:bg-nina-line/30 transition">
                  <Icon size={13} className="shrink-0" />
                  <span className="flex-1 text-left">{TYPE_META[t].label}</span>
                </button>
              )
            })}
          </div>
        </>
      )}
    </>
  )
}
