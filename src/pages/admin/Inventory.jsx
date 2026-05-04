import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { FileSpreadsheet, Package, Pencil, Plus, Search, Trash2, Upload } from 'lucide-react'
import toast from 'react-hot-toast'
import { useData } from '../../context/DataContext'
import Modal from '../../components/Modal'
import EmptyState from '../../components/EmptyState'
import ImportInventoryModal from '../../components/ImportInventoryModal'
import { fmtCOP, fmtNumber } from '../../lib/format'
import { SIZES, emptySizes } from '../../lib/seed'

const empty = {
  id: '',
  name: '',
  sku: '',
  category: '',
  color: '',
  price: 0,
  cost: 0,
  initialSizes: emptySizes(),
}

const sumSizes = (sizes) =>
  Object.values(sizes || {}).reduce((a, b) => a + Number(b || 0), 0)

export default function Inventory() {
  const { products, upsertProduct, removeProduct, setInitialSize, soldByProductSize } =
    useData()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(empty)
  const [editing, setEditing] = useState(false)
  const [tab, setTab] = useState('inicial') // inicial | final
  const [q, setQ] = useState('')
  const [importOpen, setImportOpen] = useState(false)

  const filtered = useMemo(() => {
    if (!q) return products
    const t = q.toLowerCase()
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(t) ||
        String(p.sku).toLowerCase().includes(t) ||
        p.category?.toLowerCase().includes(t) ||
        p.color?.toLowerCase().includes(t),
    )
  }, [products, q])

  const totals = useMemo(() => {
    const initial = emptySizes()
    const final = emptySizes()
    const sold = emptySizes()
    let initSum = 0
    let finalSum = 0
    let soldSum = 0
    for (const p of filtered) {
      for (const s of SIZES) {
        const i = Number(p.initialSizes?.[s] || 0)
        const cur = Number(p.sizes?.[s] || 0)
        const v = Math.max(0, i - cur)
        initial[s] += i
        final[s] += cur
        sold[s] += v
        initSum += i
        finalSum += cur
        soldSum += v
      }
    }
    return { initial, final, sold, initSum, finalSum, soldSum }
  }, [filtered])

  const openNew = () => {
    setDraft({ ...empty, id: `prod-${Date.now()}`, initialSizes: emptySizes() })
    setEditing(false)
    setOpen(true)
  }
  const openEdit = (p) => {
    setDraft({
      ...empty,
      ...p,
      initialSizes: { ...emptySizes(), ...(p.initialSizes || p.sizes || {}) },
    })
    setEditing(true)
    setOpen(true)
  }

  const save = () => {
    if (!draft.name || !draft.sku) {
      toast.error('Nombre y referencia son obligatorios')
      return
    }
    upsertProduct({
      ...draft,
      price: Number(draft.price) || 0,
      cost: Number(draft.cost) || 0,
      initialSizes: Object.fromEntries(
        SIZES.map((s) => [s, Number(draft.initialSizes[s]) || 0]),
      ),
      sizes: Object.fromEntries(SIZES.map((s) => [s, Number(draft.initialSizes[s]) || 0])),
    })
    toast.success(editing ? 'Producto actualizado' : 'Producto creado')
    setOpen(false)
  }

  const del = (p) => {
    if (!confirm(`¿Eliminar "${p.name}"? Esta acción no se puede deshacer.`)) return
    removeProduct(p.id)
    toast.success('Producto eliminado')
  }

  // Edición inline en tabla "inicial"
  const onCellBlur = (productId, size, e) => {
    const v = Number(e.target.value) || 0
    setInitialSize(productId, size, v)
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl silver-text">Inventario</h1>
          <p className="text-nina-mute text-sm mt-1">
            {products.length} referencias · {fmtNumber(totals.initSum)} unidades iniciales ·{' '}
            {fmtNumber(totals.finalSum)} disponibles
          </p>
        </div>
        <div className="flex gap-2 w-full sm:w-auto flex-wrap">
          {products.length > 0 && (
            <div className="relative flex-1 sm:w-72">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-nina-mute" />
              <input
                className="input pl-10"
                placeholder="Buscar por nombre, referencia, color…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
          )}
          <button onClick={() => setImportOpen(true)} className="btn-ghost whitespace-nowrap">
            <Upload className="w-4 h-4" />
            Importar Excel
          </button>
          <button onClick={openNew} className="btn-primary whitespace-nowrap">
            <Plus className="w-4 h-4" />
            Nueva referencia
          </button>
        </div>
      </div>

      {products.length === 0 ? (
        <EmptyState
          icon={Package}
          title="Aún no hay inventario cargado"
          description="Importa el Excel del inventario inicial o crea referencias una por una. Cada referencia debe tener cantidad por talla (6, 8, 10, 12, 14)."
          actions={
            <>
              <button onClick={() => setImportOpen(true)} className="btn-primary">
                <FileSpreadsheet className="w-4 h-4" />
                Importar Excel
              </button>
              <button onClick={openNew} className="btn-ghost">
                <Plus className="w-4 h-4" />
                Crear manual
              </button>
            </>
          }
        />
      ) : (
        <>
      {/* Tabs Inicial / Final */}
      <div className="flex gap-1 p-1 bg-nina-ink border border-nina-line rounded-xl w-fit">
        {[
          { id: 'inicial', label: 'Inventario inicial' },
          { id: 'final', label: 'Inventario final' },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`relative px-4 py-1.5 text-sm rounded-lg transition ${
              tab === t.id
                ? 'text-nina-black'
                : 'text-nina-mute hover:text-nina-chrome'
            }`}
          >
            {tab === t.id && (
              <motion.span
                layoutId="invTabBg"
                className="absolute inset-0 rounded-lg bg-silver-gradient shadow-chrome"
                transition={{ type: 'spring', stiffness: 400, damping: 32 }}
              />
            )}
            <span className="relative">{t.label}</span>
          </button>
        ))}
      </div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="panel overflow-hidden"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-nina-mute uppercase text-[10px] tracking-[0.18em] border-b border-nina-line bg-nina-ink/60">
                <th className="px-3 py-3 font-medium">Referencia</th>
                <th className="px-3 py-3 font-medium">Nombre</th>
                {SIZES.map((s) => (
                  <th key={s} className="px-2 py-3 font-medium text-center w-16">
                    Talla {s}
                  </th>
                ))}
                <th className="px-3 py-3 font-medium text-center">Total</th>
                <th className="px-3 py-3 font-medium text-right">Precio</th>
                <th className="px-3 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p, i) => {
                const initialTotal = sumSizes(p.initialSizes)
                const finalTotal = sumSizes(p.sizes)
                return (
                  <motion.tr
                    key={p.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.01 }}
                    className="border-b border-nina-line/40 hover:bg-nina-line/20 transition"
                  >
                    <td className="px-3 py-2 font-mono text-nina-chrome">{p.sku}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium truncate max-w-[200px]">{p.name}</div>
                      <div className="text-[10px] text-nina-mute">
                        {p.category} · {p.color}
                      </div>
                    </td>
                    {SIZES.map((s) => {
                      const initial = Number(p.initialSizes?.[s] || 0)
                      const current = Number(p.sizes?.[s] || 0)
                      const sold = Math.max(0, initial - current)
                      const value = tab === 'inicial' ? initial : current
                      const out = value === 0
                      return (
                        <td key={s} className="px-1 py-1 text-center">
                          {tab === 'inicial' ? (
                            <input
                              type="number"
                              defaultValue={initial}
                              onBlur={(e) => onCellBlur(p.id, s, e)}
                              className={`w-14 text-center bg-transparent border border-transparent hover:border-nina-line focus:border-nina-silver/50 focus:bg-nina-ink rounded py-1.5 outline-none transition ${
                                out ? 'text-nina-mute/60' : 'text-nina-chrome'
                              }`}
                              min="0"
                            />
                          ) : (
                            <div
                              className={`relative py-1.5 rounded ${
                                out
                                  ? 'text-red-300/60'
                                  : current <= 2
                                  ? 'text-amber-200'
                                  : 'text-nina-chrome'
                              }`}
                              title={
                                sold > 0
                                  ? `Inicial ${initial} − Vendidas ${sold} = ${current}`
                                  : `Inicial ${initial}`
                              }
                            >
                              <span className="font-semibold">{current}</span>
                              {sold > 0 && (
                                <span className="block text-[9px] text-nina-mute leading-tight">
                                  -{sold}
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                      )
                    })}
                    <td className="px-3 py-2 text-center silver-text font-semibold">
                      {tab === 'inicial' ? initialTotal : finalTotal}
                    </td>
                    <td className="px-3 py-2 text-right silver-text font-medium whitespace-nowrap">
                      {fmtCOP(p.price)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1 justify-end">
                        <button onClick={() => openEdit(p)} className="btn-ghost !p-1.5">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => del(p)} className="btn-danger !p-1.5">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </motion.tr>
                )
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={SIZES.length + 5} className="text-center py-10 text-nina-mute">
                    No hay productos. Crea la primera referencia.
                  </td>
                </tr>
              )}
            </tbody>
            {filtered.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-nina-line bg-nina-ink/40 font-semibold">
                  <td colSpan={2} className="px-3 py-3 text-[11px] uppercase tracking-[0.18em] text-nina-mute">
                    Totales
                  </td>
                  {SIZES.map((s) => (
                    <td key={s} className="px-2 py-3 text-center silver-text">
                      {tab === 'inicial' ? totals.initial[s] : totals.final[s]}
                    </td>
                  ))}
                  <td className="px-3 py-3 text-center silver-text font-display text-base">
                    {tab === 'inicial' ? totals.initSum : totals.finalSum}
                  </td>
                  <td colSpan={2}></td>
                </tr>
                {tab === 'final' && totals.soldSum > 0 && (
                  <tr className="text-[11px] text-nina-mute border-t border-nina-line/50">
                    <td colSpan={2} className="px-3 py-2 uppercase tracking-[0.18em]">
                      Vendidas
                    </td>
                    {SIZES.map((s) => (
                      <td key={s} className="px-2 py-2 text-center text-amber-300/80">
                        {totals.sold[s] || ''}
                      </td>
                    ))}
                    <td className="px-3 py-2 text-center text-amber-300/80">
                      {totals.soldSum}
                    </td>
                    <td colSpan={2}></td>
                  </tr>
                )}
              </tfoot>
            )}
          </table>
        </div>
      </motion.div>

      {tab === 'inicial' && filtered.length > 0 && (
        <p className="text-[11px] text-nina-mute">
          Tip: las celdas son editables. Click en una talla para ajustar el inventario inicial.
          Las ventas registradas se conservan.
        </p>
      )}
        </>
      )}

      <ImportInventoryModal open={importOpen} onClose={() => setImportOpen(false)} />

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Editar referencia' : 'Nueva referencia'}
        maxWidth="max-w-2xl"
      >
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Referencia</label>
            <input
              className="input font-mono"
              value={draft.sku}
              onChange={(e) => setDraft({ ...draft, sku: e.target.value })}
              placeholder="20210"
            />
          </div>
          <div>
            <label className="label">Nombre</label>
            <input
              className="input"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Vestido Sirena Plata"
            />
          </div>
          <div>
            <label className="label">Categoría</label>
            <input
              className="input"
              value={draft.category}
              onChange={(e) => setDraft({ ...draft, category: e.target.value })}
              placeholder="Vestidos"
            />
          </div>
          <div>
            <label className="label">Color</label>
            <input
              className="input"
              value={draft.color}
              onChange={(e) => setDraft({ ...draft, color: e.target.value })}
              placeholder="Plateado"
            />
          </div>
          <div>
            <label className="label">Precio venta (COP)</label>
            <input
              type="number"
              className="input"
              value={draft.price}
              onChange={(e) => setDraft({ ...draft, price: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Costo (opcional)</label>
            <input
              type="number"
              className="input"
              value={draft.cost}
              onChange={(e) => setDraft({ ...draft, cost: e.target.value })}
            />
          </div>

          <div className="sm:col-span-2">
            <label className="label">Stock inicial por talla</label>
            <div className="grid grid-cols-5 gap-2">
              {SIZES.map((s) => (
                <div key={s}>
                  <div className="text-center text-[11px] uppercase tracking-[0.2em] text-nina-mute mb-1">
                    Talla {s}
                  </div>
                  <input
                    type="number"
                    min="0"
                    className="input text-center"
                    value={draft.initialSizes[s] ?? 0}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        initialSizes: { ...draft.initialSizes, [s]: e.target.value },
                      })
                    }
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button onClick={() => setOpen(false)} className="btn-ghost">
            Cancelar
          </button>
          <button onClick={save} className="btn-primary">
            {editing ? 'Guardar cambios' : 'Crear referencia'}
          </button>
        </div>
      </Modal>
    </div>
  )
}
