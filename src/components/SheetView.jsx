// Visor / editor de HOJAS DE CÁLCULO — se monta como artefacto kind:'sheet' en el canvas
// (ArtifactCanvas). Núcleo: grilla editable (encabezados + celdas), agregar/eliminar filas y
// columnas, fila de TOTALES de columnas 100% numéricas, y export a CSV. Tema oscuro NINA.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Calculator, Download, Plus, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'

// ¿La celda es numérica? Acepta enteros/decimales con separadores de miles y símbolos comunes
// ($, %, espacios). Devuelve el número o null. Una columna "numérica" = todas sus celdas no
// vacías son numéricas (al menos una con dato).
function parseNum(v) {
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (!s) return null
  const cleaned = s.replace(/[$\s%]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(/,/g, '.')
  if (!/^-?\d*\.?\d+$/.test(cleaned)) return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

export default function SheetView({ title: initialTitle, columns: initialColumns, rows: initialRows, getContentRef, onChange }) {
  const [title, setTitle] = useState(initialTitle || 'Hoja de cálculo')
  const [columns, setColumns] = useState(() => (Array.isArray(initialColumns) && initialColumns.length ? initialColumns.map(String) : ['Columna 1']))
  const [rows, setRows] = useState(() => {
    const cols = Array.isArray(initialColumns) && initialColumns.length ? initialColumns.length : 1
    const r = Array.isArray(initialRows) ? initialRows : []
    const norm = r.map((row) => Array.from({ length: cols }, (_, i) => (Array.isArray(row) ? String(row[i] ?? '') : '')))
    return norm.length ? norm : [Array.from({ length: cols }, () => '')]
  })
  const [showTotals, setShowTotals] = useState(true)

  // Reporte de cambios (debounced) → el padre limpia "guardado" y persiste si es pestaña local.
  const stateRef = useRef({ title, columns, rows })
  stateRef.current = { title, columns, rows }
  const fireTimer = useRef(null)
  const dirtyRef = useRef(false) // solo true tras una edición real → abrir+cambiar de pestaña no marca dirty
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
  const setColName = (ci, val) => { setColumns((prev) => prev.map((c, i) => (i === ci ? val : c))); scheduleFire() }
  const addRow = () => { setRows((prev) => [...prev, columns.map(() => '')]); scheduleFire() }
  const removeRow = (ri) => { setRows((prev) => (prev.length <= 1 ? [columns.map(() => '')] : prev.filter((_, i) => i !== ri))); scheduleFire() }
  const addColumn = () => {
    setColumns((prev) => [...prev, `Columna ${prev.length + 1}`])
    setRows((prev) => prev.map((r) => [...r, '']))
    scheduleFire()
  }
  const removeColumn = (ci) => {
    if (columns.length <= 1) return
    setColumns((prev) => prev.filter((_, i) => i !== ci))
    setRows((prev) => prev.map((r) => r.filter((_, i) => i !== ci)))
    scheduleFire()
  }

  // Totales: por columna, si TODAS las celdas no vacías son numéricas (y hay al menos una), suma.
  const totals = useMemo(() => {
    return columns.map((_, ci) => {
      let sum = 0
      let count = 0
      for (const r of rows) {
        const raw = r[ci]
        if (typeof raw !== 'string' || raw.trim() === '') continue
        const n = parseNum(raw)
        if (n == null) return null // columna no totalmente numérica → sin total
        sum += n
        count++
      }
      return count ? sum : null
    })
  }, [columns, rows])

  const fmtTotal = (n) => {
    if (n == null) return ''
    const rounded = Math.round(n * 100) / 100
    return rounded.toLocaleString('es-CO', { maximumFractionDigits: 2 })
  }

  const exportCSV = () => {
    const esc = (s) => {
      const v = String(s ?? '')
      return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
    }
    const lines = [columns.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))]
    const csv = '﻿' + lines.join('\r\n') // BOM para que Excel respete UTF-8
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    a.download = `${(title || 'hoja').replace(/[^\w\- ]+/g, '').trim() || 'hoja'}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
    toast.success('CSV descargado')
  }

  const cellCls = 'w-full bg-transparent px-2 py-1.5 text-[12.5px] text-nina-chrome/90 outline-none focus:bg-nina-line/30 transition'

  return (
    <div className="h-full flex flex-col bg-nina-ink">
      {/* Barra superior: título + acciones */}
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-nina-line/50 shrink-0">
        <input
          value={title}
          onChange={(e) => { setTitle(e.target.value); scheduleFire() }}
          placeholder="Título de la hoja"
          className="min-w-0 flex-1 bg-transparent text-nina-chrome text-[13px] font-medium outline-none placeholder:text-nina-mute/40"
        />
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-[11px] text-nina-mute px-1">{rows.length}×{columns.length}</span>
          <button
            onClick={() => setShowTotals((v) => !v)}
            className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11.5px] transition ${
              showTotals ? 'bg-silver-gradient text-nina-black' : 'text-nina-mute hover:text-nina-chrome hover:bg-nina-line/40'
            }`}
            title="Mostrar/ocultar totales"
          >
            <Calculator size={13} /> Totales
          </button>
          <button onClick={exportCSV} className="flex items-center gap-1 px-2 py-1 rounded-md text-[11.5px] text-nina-mute hover:text-nina-chrome hover:bg-nina-line/40 transition" title="Descargar CSV">
            <Download size={13} /> CSV
          </button>
        </div>
      </div>

      {/* Grilla */}
      <div className="flex-1 min-h-0 overflow-auto">
        <table className="border-collapse" style={{ minWidth: '100%' }}>
          <thead className="sticky top-0 z-10">
            <tr>
              <th className="sticky left-0 z-20 bg-nina-panel border-b border-r border-nina-line/60 w-9" />
              {columns.map((c, ci) => (
                <th key={ci} className="group bg-nina-panel border-b border-r border-nina-line/60 min-w-[120px] text-left">
                  <div className="flex items-center">
                    <input
                      value={c}
                      onChange={(e) => setColName(ci, e.target.value)}
                      placeholder={`Columna ${ci + 1}`}
                      className="w-full bg-transparent px-2 py-1.5 text-[12px] font-semibold text-nina-chrome outline-none focus:bg-nina-line/30 placeholder:text-nina-mute/40"
                    />
                    <button
                      onClick={() => removeColumn(ci)}
                      disabled={columns.length <= 1}
                      className="px-1 opacity-0 group-hover:opacity-100 text-nina-mute hover:text-red-300 disabled:opacity-0 transition shrink-0"
                      title="Eliminar columna"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </th>
              ))}
              <th className="bg-nina-panel border-b border-nina-line/60 w-9">
                <button onClick={addColumn} className="w-full h-full grid place-items-center text-nina-mute hover:text-nina-chrome py-1.5" title="Agregar columna">
                  <Plus size={14} />
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri} className="group">
                <td className="sticky left-0 z-10 bg-nina-ink border-b border-r border-nina-line/40 text-center align-middle">
                  <div className="relative w-9 h-full grid place-items-center">
                    <span className="text-[10px] text-nina-mute group-hover:opacity-0">{ri + 1}</span>
                    <button
                      onClick={() => removeRow(ri)}
                      className="absolute inset-0 grid place-items-center opacity-0 group-hover:opacity-100 text-nina-mute hover:text-red-300 transition"
                      title="Eliminar fila"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </td>
                {r.map((cell, ci) => (
                  <td key={ci} className="border-b border-r border-nina-line/40 p-0">
                    <input
                      value={cell}
                      onChange={(e) => setCell(ri, ci, e.target.value)}
                      className={`${cellCls} ${parseNum(cell) != null ? 'text-right tabular-nums' : ''}`}
                    />
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
                  <td key={ci} className="bg-nina-panel border-t border-r border-nina-line/60 px-2 py-1.5 text-right text-[12.5px] font-semibold text-nina-chrome tabular-nums">
                    {fmtTotal(t)}
                  </td>
                ))}
                <td className="bg-nina-panel border-t border-nina-line/60" />
              </tr>
            </tfoot>
          )}
        </table>
        {/* Agregar fila */}
        <button onClick={addRow} className="flex items-center gap-1.5 px-3 py-2 text-[12px] text-nina-mute hover:text-nina-chrome transition">
          <Plus size={13} /> fila
        </button>
      </div>
    </div>
  )
}
