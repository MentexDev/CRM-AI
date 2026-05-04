import { useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Upload,
  X,
} from 'lucide-react'
import * as XLSX from 'xlsx'
import toast from 'react-hot-toast'
import Modal from './Modal'
import { useData } from '../context/DataContext'
import { SIZES, emptySizes } from '../lib/seed'
import { fmtCOP } from '../lib/format'

// Header sinónimos aceptados al leer el Excel/CSV (case-insensitive, sin tildes)
const HEADER_MAP = {
  referencia: 'sku',
  ref: 'sku',
  sku: 'sku',
  codigo: 'sku',
  nombre: 'name',
  producto: 'name',
  descripcion: 'name',
  categoria: 'category',
  color: 'color',
  precio: 'price',
  'precio venta': 'price',
  costo: 'cost',
  // tallas (se generan dinámico abajo)
}
for (const s of SIZES) {
  HEADER_MAP[`talla ${s}`] = `size_${s}`
  HEADER_MAP[`talla${s}`] = `size_${s}`
  HEADER_MAP[`t${s}`] = `size_${s}`
  HEADER_MAP[s] = `size_${s}`
}

const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()

const parseRow = (row) => {
  const out = { sizes: emptySizes() }
  for (const [rawKey, value] of Object.entries(row)) {
    const key = norm(rawKey)
    const target = HEADER_MAP[key]
    if (!target) continue
    if (target.startsWith('size_')) {
      const size = target.slice(5)
      out.sizes[size] = Number(value) || 0
    } else if (target === 'price' || target === 'cost') {
      out[target] = Number(String(value).replace(/[^\d.-]/g, '')) || 0
    } else {
      out[target] = String(value ?? '').trim()
    }
  }
  return out
}

export default function ImportInventoryModal({ open, onClose }) {
  const { upsertProduct, products } = useData()
  const [parsed, setParsed] = useState(null) // { rows: [], errors: [], filename: '' }
  const [busy, setBusy] = useState(false)
  const fileRef = useRef(null)

  const reset = () => {
    setParsed(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  const onFile = async (file) => {
    if (!file) return
    setBusy(true)
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      const sheet = wb.Sheets[wb.SheetNames[0]]
      const json = XLSX.utils.sheet_to_json(sheet, { defval: '' })

      const rows = []
      const errors = []
      json.forEach((raw, i) => {
        const lineNo = i + 2 // +1 por header, +1 por base 1
        const r = parseRow(raw)
        if (!r.sku && !r.name) return // fila totalmente vacía → ignora
        if (!r.sku) errors.push(`Fila ${lineNo}: falta Referencia`)
        if (!r.name) errors.push(`Fila ${lineNo}: falta Nombre`)
        if (!r.price || r.price <= 0)
          errors.push(`Fila ${lineNo}: precio inválido (${r.price || '—'})`)
        const totalStock = Object.values(r.sizes).reduce((a, b) => a + b, 0)
        rows.push({ ...r, totalStock })
      })

      if (rows.length === 0) {
        toast.error('No se encontraron filas válidas en el archivo')
        setBusy(false)
        return
      }
      setParsed({ rows, errors, filename: file.name })
    } catch (err) {
      toast.error('No se pudo leer el archivo: ' + err.message)
    } finally {
      setBusy(false)
    }
  }

  const onDrop = (e) => {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (file) onFile(file)
  }

  const confirm = async () => {
    if (!parsed) return
    setBusy(true)
    let imported = 0
    let updated = 0
    let failed = 0
    for (const r of parsed.rows) {
      if (!r.sku || !r.name || !r.price) continue
      const existing = products.find(
        (p) => String(p.sku).toLowerCase() === String(r.sku).toLowerCase(),
      )
      try {
        await upsertProduct({
          id: existing?.id,
          sku: r.sku,
          name: r.name,
          category: r.category || '',
          color: r.color || '',
          price: r.price,
          cost: r.cost || 0,
          initialSizes: r.sizes,
          sizes: r.sizes,
        })
        if (existing) updated += 1
        else imported += 1
      } catch {
        failed += 1
      }
    }
    setBusy(false)
    toast.success(
      `${imported} nuevas` +
        (updated > 0 ? ` · ${updated} actualizadas` : '') +
        (failed > 0 ? ` · ${failed} con error` : ''),
    )
    handleClose()
  }

  const downloadTemplate = () => {
    const headers = [
      'Referencia',
      'Nombre',
      'Categoria',
      'Color',
      'Precio',
      'Costo',
      ...SIZES.map((s) => `Talla ${s}`),
    ]
    const sample = [
      '20210',
      'Vestido Sirena Plata',
      'Vestidos',
      'Plateado',
      189000,
      78000,
      6,
      8,
      6,
      9,
      5,
    ]
    const ws = XLSX.utils.aoa_to_sheet([headers, sample])
    // Ancho de columnas
    ws['!cols'] = [
      { wch: 14 },
      { wch: 32 },
      { wch: 14 },
      { wch: 12 },
      { wch: 12 },
      { wch: 12 },
      ...SIZES.map(() => ({ wch: 10 })),
    ]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Inventario')
    XLSX.writeFile(wb, 'plantilla_inventario_NINA.xlsx')
  }

  const totalUnits =
    parsed?.rows.reduce((a, r) => a + (r.totalStock || 0), 0) || 0
  const totalValue =
    parsed?.rows.reduce((a, r) => a + (r.price || 0) * (r.totalStock || 0), 0) || 0

  return (
    <Modal open={open} onClose={handleClose} title="Importar inventario" maxWidth="max-w-3xl">
      {!parsed ? (
        <div className="space-y-5">
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            className="border-2 border-dashed border-nina-line rounded-2xl p-10 text-center hover:border-nina-silver/40 transition cursor-pointer bg-nina-ink/40"
            onClick={() => fileRef.current?.click()}
          >
            <FileSpreadsheet className="w-10 h-10 mx-auto mb-3 text-nina-silver" />
            <p className="silver-text font-display text-lg mb-1">
              Arrastra tu archivo Excel
            </p>
            <p className="text-xs text-nina-mute mb-4">
              .xlsx · .xls · .csv — máximo 10MB
            </p>
            <button type="button" className="btn-primary" disabled={busy}>
              <Upload className="w-4 h-4" />
              {busy ? 'Leyendo…' : 'Seleccionar archivo'}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => onFile(e.target.files?.[0])}
            />
          </div>

          <div className="rounded-xl border border-nina-line bg-nina-ink p-4">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <h4 className="font-medium text-nina-chrome mb-1">Formato esperado</h4>
                <p className="text-xs text-nina-mute">
                  Una fila por referencia. La primera fila debe tener los encabezados.
                </p>
              </div>
              <button onClick={downloadTemplate} className="btn-ghost text-xs whitespace-nowrap">
                <Download className="w-3.5 h-3.5" />
                Plantilla
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-left text-nina-mute uppercase tracking-[0.15em] border-b border-nina-line">
                    <th className="px-2 py-1.5">Columna</th>
                    <th className="px-2 py-1.5">Obligatoria</th>
                    <th className="px-2 py-1.5">Ejemplo</th>
                  </tr>
                </thead>
                <tbody className="text-nina-chrome">
                  {[
                    ['Referencia', 'Sí', '20210'],
                    ['Nombre', 'Sí', 'Vestido Sirena Plata'],
                    ['Precio', 'Sí', '189000'],
                    ['Categoria', 'No', 'Vestidos'],
                    ['Color', 'No', 'Plateado'],
                    ['Costo', 'No', '78000'],
                    ...SIZES.map((s) => [`Talla ${s}`, 'Sí', '6']),
                  ].map(([col, req, ex]) => (
                    <tr key={col} className="border-b border-nina-line/40">
                      <td className="px-2 py-1.5 font-mono">{col}</td>
                      <td className="px-2 py-1.5 text-nina-mute">{req}</td>
                      <td className="px-2 py-1.5 text-nina-mute">{ex}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[10px] text-nina-mute mt-2">
              Si una referencia ya existe en el inventario, se <strong>actualiza</strong> (no
              se duplica).
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl border border-nina-line bg-nina-ink p-4 flex items-center gap-3">
            <FileSpreadsheet className="w-6 h-6 text-nina-silver" />
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{parsed.filename}</div>
              <div className="text-xs text-nina-mute">
                {parsed.rows.length} referencias · {totalUnits} unidades ·{' '}
                {fmtCOP(totalValue)} en valor
              </div>
            </div>
            <button onClick={reset} className="btn-ghost !p-2">
              <X className="w-4 h-4" />
            </button>
          </div>

          {parsed.errors.length > 0 && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs">
              <div className="flex items-center gap-1.5 text-amber-300 mb-2 uppercase tracking-[0.18em]">
                <AlertTriangle className="w-3.5 h-3.5" />
                {parsed.errors.length} advertencia{parsed.errors.length !== 1 && 's'}
              </div>
              <ul className="text-amber-200/80 list-disc pl-5 space-y-0.5 max-h-32 overflow-auto">
                {parsed.errors.slice(0, 20).map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
                {parsed.errors.length > 20 && (
                  <li>… y {parsed.errors.length - 20} más</li>
                )}
              </ul>
              <p className="mt-2 text-amber-200/70">
                Las filas con errores no se importarán. El resto sí.
              </p>
            </div>
          )}

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="panel overflow-hidden max-h-80 overflow-y-auto"
          >
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-nina-panel">
                <tr className="text-left text-nina-mute uppercase tracking-[0.15em] border-b border-nina-line">
                  <th className="px-2 py-2">Ref.</th>
                  <th className="px-2 py-2">Nombre</th>
                  {SIZES.map((s) => (
                    <th key={s} className="px-1 py-2 text-center">
                      T{s}
                    </th>
                  ))}
                  <th className="px-2 py-2 text-center">Total</th>
                  <th className="px-2 py-2 text-right">Precio</th>
                </tr>
              </thead>
              <tbody>
                {parsed.rows.slice(0, 50).map((r, i) => (
                  <tr key={i} className="border-b border-nina-line/40">
                    <td className="px-2 py-1.5 font-mono">{r.sku || '—'}</td>
                    <td className="px-2 py-1.5 truncate max-w-[180px]">{r.name || '—'}</td>
                    {SIZES.map((s) => (
                      <td key={s} className="px-1 py-1.5 text-center">
                        {r.sizes?.[s] || ''}
                      </td>
                    ))}
                    <td className="px-2 py-1.5 text-center silver-text font-semibold">
                      {r.totalStock}
                    </td>
                    <td className="px-2 py-1.5 text-right whitespace-nowrap">
                      {fmtCOP(r.price)}
                    </td>
                  </tr>
                ))}
                {parsed.rows.length > 50 && (
                  <tr>
                    <td colSpan={SIZES.length + 4} className="text-center py-2 text-nina-mute">
                      +{parsed.rows.length - 50} filas más
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </motion.div>

          <div className="flex justify-end gap-2">
            <button onClick={reset} className="btn-ghost">
              Subir otro archivo
            </button>
            <button onClick={confirm} className="btn-primary">
              <CheckCircle2 className="w-4 h-4" />
              Confirmar importación
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
