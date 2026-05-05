import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Banknote,
  CheckCircle2,
  Plus,
  Receipt,
  ShoppingBag,
  Sparkles,
  Trophy,
} from 'lucide-react'
import TopBar from '../../components/TopBar'
import ProgressBar from '../../components/ProgressBar'
import SaleModal from '../../components/SaleModal'
import { useAuth } from '../../context/AuthContext'
import { useData } from '../../context/DataContext'
import {
  fmtCOP,
  fmtDate,
  fmtNumber,
  fmtPrizeRemaining,
  fmtPrizeThreshold,
  prizeProgress,
} from '../../lib/format'
import { SIZES } from '../../lib/seed'

export default function SellerDashboard() {
  const { user, listSellers } = useAuth()
  const { products, sales, prizes } = useData()
  const [open, setOpen] = useState(false)

  const me = listSellers().find((s) => s.id === user?.id) || user
  const goal = me?.goal ?? 3000000

  const mySales = useMemo(
    () => sales.filter((s) => s.sellerId === user?.id),
    [sales, user],
  )
  const myTotal = mySales.reduce((a, s) => a + s.total, 0)
  const myUnits = mySales.reduce((a, s) => a + s.quantity, 0)
  const myStats = { total: myTotal, units: myUnits }

  const sortedPrizes = useMemo(
    () =>
      [...prizes].sort((a, b) => {
        const ra = prizeProgress(a, myStats).remaining
        const rb = prizeProgress(b, myStats).remaining
        return ra - rb
      }),
    [prizes, myTotal, myUnits],
  )
  const nextPrize = useMemo(
    () => sortedPrizes.find((p) => !prizeProgress(p, myStats).unlocked),
    [sortedPrizes, myTotal, myUnits],
  )
  const unlockedPrizes = prizes.filter((p) => prizeProgress(p, myStats).unlocked)

  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Hero */}
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="panel p-6 sm:p-8 relative overflow-hidden"
        >
          <div
            aria-hidden
            className="absolute -top-32 -right-20 w-[500px] h-[500px] rounded-full opacity-50 blur-3xl pointer-events-none"
            style={{
              background:
                'radial-gradient(circle, rgba(232,232,232,0.18), transparent 70%)',
            }}
          />
          <div className="relative">
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <div>
                <div className="text-[10px] uppercase tracking-[0.4em] text-nina-mute mb-1">
                  Hola
                </div>
                <h1 className="font-display text-3xl sm:text-4xl silver-text">
                  {user?.name?.split(' ')[0]} ✨
                </h1>
                <p className="text-nina-mute text-sm mt-1">
                  Tu progreso de ventas en la feria WEIN.
                </p>
              </div>
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-[0.3em] text-nina-mute">
                  Vendido
                </div>
                <div className="silver-text font-display text-3xl sm:text-4xl font-bold">
                  {fmtCOP(myTotal)}
                </div>
                <div className="text-xs text-nina-mute">
                  {fmtNumber(mySales.length)} líneas · {fmtNumber(myUnits)} unidades
                </div>
                <div className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] text-nina-mute">
                  <span className="uppercase tracking-[0.2em]">Meta</span>
                  <span className="silver-text font-semibold">{fmtCOP(goal)}</span>
                </div>
              </div>
            </div>

            <div className="mt-6">
              <ProgressBar value={myTotal} goal={goal} />
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button onClick={() => setOpen(true)} className="btn-primary !py-3 !px-6">
                <Plus className="w-4 h-4" />
                Registrar venta
              </button>
              {nextPrize && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.4 }}
                  className="flex items-center gap-3 rounded-xl border border-nina-silver/20 bg-nina-ink/60 p-3 flex-1 min-w-[260px]"
                >
                  <div className="text-2xl animate-float">{nextPrize.icon}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] uppercase tracking-[0.25em] text-nina-mute">
                      Próximo premio
                    </div>
                    <div className="font-medium text-sm truncate">{nextPrize.name}</div>
                    <div className="text-[11px] text-nina-mute">
                      {fmtPrizeRemaining(nextPrize, myStats)}
                    </div>
                  </div>
                  <Sparkles className="w-4 h-4 text-nina-silver" />
                </motion.div>
              )}
            </div>
          </div>
        </motion.section>

        {/* Stats rápidos */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat icon={Banknote} label="Vendido" value={fmtCOP(myTotal)} />
          <Stat icon={ShoppingBag} label="Unidades" value={fmtNumber(myUnits)} />
          <Stat icon={Receipt} label="Ventas" value={fmtNumber(mySales.length)} />
          <Stat
            icon={Trophy}
            label="Premios"
            value={`${unlockedPrizes.length}/${prizes.length}`}
          />
        </div>

        {/* Catálogo (referencia rápida del stock) */}
        <section>
          <div className="flex items-end justify-between mb-4">
            <h2 className="font-display text-2xl silver-text">Catálogo</h2>
            <button onClick={() => setOpen(true)} className="btn-primary text-xs">
              <Plus className="w-3.5 h-3.5" />
              Registrar venta
            </button>
          </div>
          {products.length === 0 ? (
            <div className="panel p-10 text-center text-nina-mute text-sm">
              Aún no hay productos en el catálogo. La administración debe cargar el inventario.
            </div>
          ) : (
          <div className="panel overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-nina-mute uppercase text-[10px] tracking-[0.18em] border-b border-nina-line bg-nina-ink/60">
                    <th className="px-3 py-3">Ref.</th>
                    <th className="px-3 py-3">Nombre</th>
                    {SIZES.map((s) => (
                      <th key={s} className="px-2 py-3 text-center w-14">
                        T{s}
                      </th>
                    ))}
                    <th className="px-3 py-3 text-right">Precio</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((p) => (
                    <tr
                      key={p.id}
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
                        const q = Number(p.sizes?.[s] || 0)
                        return (
                          <td
                            key={s}
                            className={`px-2 py-2 text-center font-semibold ${
                              q === 0
                                ? 'text-red-300/50'
                                : q <= 2
                                ? 'text-amber-200'
                                : 'text-nina-chrome'
                            }`}
                          >
                            {q || '—'}
                          </td>
                        )
                      })}
                      <td className="px-3 py-2 text-right silver-text font-semibold whitespace-nowrap">
                        {fmtCOP(p.price)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          )}
        </section>

        {/* Mis ventas */}
        <section>
          <h2 className="font-display text-2xl silver-text mb-4">Mis ventas</h2>
          {mySales.length === 0 ? (
            <div className="panel p-8 text-center text-nina-mute text-sm">
              Aún no has registrado ventas. ¡A brillar! ✨
            </div>
          ) : (
            <div className="panel overflow-hidden">
              <ul className="divide-y divide-nina-line/50">
                {mySales.slice(0, 30).map((s) => (
                  <li
                    key={s.id}
                    className="flex items-center justify-between gap-3 px-5 py-3"
                  >
                    <div className="min-w-0">
                      <div className="font-medium truncate">
                        <span className="font-mono text-nina-mute mr-2">{s.sku}</span>
                        {s.productName}
                      </div>
                      <div className="text-xs text-nina-mute">
                        Talla {s.size} · {s.quantity} u · {s.paymentMethod} ·{' '}
                        {fmtDate(s.soldAt)}
                        {s.discount > 0 && (
                          <span className="text-amber-300/80">
                            {' '}
                            · −{fmtCOP(s.discount)}
                          </span>
                        )}
                        {s.customer?.name && s.customer.name !== 'NA' && (
                          <span> · {s.customer.name}</span>
                        )}
                      </div>
                    </div>
                    <span className="silver-text font-semibold whitespace-nowrap">
                      {fmtCOP(s.total)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {/* Premios */}
        {prizes.length > 0 && (
        <section>
          <h2 className="font-display text-2xl silver-text mb-4">Tus premios</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {sortedPrizes.map((p, i) => {
              const { unlocked, type } = prizeProgress(p, myStats)
              return (
                <motion.div
                  key={p.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.05 * i }}
                  className={`rounded-xl border p-4 transition ${
                    unlocked
                      ? 'border-nina-silver/40 shadow-glow'
                      : 'border-nina-line bg-nina-ink'
                  }`}
                  style={
                    unlocked
                      ? {
                          background:
                            'linear-gradient(135deg, rgba(232,232,232,0.12), rgba(200,200,200,0.04))',
                        }
                      : undefined
                  }
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="text-2xl">{p.icon}</div>
                    {unlocked ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-300" />
                    ) : (
                      <span
                        className={`text-[9px] uppercase tracking-[0.2em] px-1.5 py-0.5 rounded-full border ${
                          type === 'units'
                            ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
                            : 'border-nina-line bg-nina-line/40 text-nina-silver'
                        }`}
                      >
                        {type === 'units' ? 'Unid.' : 'COP'}
                      </span>
                    )}
                  </div>
                  <div className="text-xs uppercase tracking-[0.2em] text-nina-mute mb-1">
                    {fmtPrizeThreshold(p)}
                  </div>
                  <div
                    className={`font-medium ${unlocked ? 'silver-text' : 'text-nina-chrome'}`}
                  >
                    {p.name}
                  </div>
                  {!unlocked && (
                    <div className="text-[10px] text-nina-mute mt-1">
                      {fmtPrizeRemaining(p, myStats)}
                    </div>
                  )}
                </motion.div>
              )
            })}
          </div>
        </section>
        )}
      </main>

      {/* FAB siempre visible: registrar venta */}
      <motion.button
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.2, type: 'spring', stiffness: 260, damping: 20 }}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => setOpen(true)}
        className="fixed z-30 btn-primary !rounded-full !p-4 shadow-glow group"
        style={{
          bottom: 'calc(1.5rem + env(safe-area-inset-bottom))',
          right: 'calc(1.5rem + env(safe-area-inset-right))',
        }}
        aria-label="Registrar venta"
        title="Registrar venta"
      >
        <Plus className="w-6 h-6" />
        <span className="hidden md:inline absolute right-full mr-3 top-1/2 -translate-y-1/2 px-3 py-1.5 rounded-lg bg-nina-panel border border-nina-line text-xs text-nina-chrome whitespace-nowrap opacity-0 group-hover:opacity-100 transition pointer-events-none">
          Registrar venta
        </span>
      </motion.button>

      <SaleModal open={open} onClose={() => setOpen(false)} fixedSellerId={user?.id} />
    </div>
  )
}

function Stat({ icon: Icon, label, value }) {
  return (
    <div className="panel panel-hover p-4 flex items-center gap-3">
      <div className="p-2 rounded-lg bg-nina-line/60 border border-nina-line">
        <Icon className="w-4 h-4 text-nina-silver" />
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-[0.18em] text-nina-mute">{label}</div>
        <div className="silver-text font-display font-semibold text-lg">{value}</div>
      </div>
    </div>
  )
}
