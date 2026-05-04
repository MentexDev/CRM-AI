import { motion } from 'framer-motion'
import { Banknote, Package, ShoppingBag, Users, TrendingUp } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useData } from '../../context/DataContext'
import StatCard from '../../components/StatCard'
import ProgressBar from '../../components/ProgressBar'
import { fmtCOP, fmtDate, fmtNumber, totalStock } from '../../lib/format'

export default function Overview() {
  const { listSellers } = useAuth()
  const { products, sales, totals, totalsBySeller } = useData()
  const sellers = listSellers().filter((s) => s.role === 'seller')

  const stockUnits = products.reduce((a, p) => a + totalStock(p.sizes), 0)
  const inventoryValue = products.reduce(
    (a, p) => a + p.price * totalStock(p.sizes),
    0,
  )

  const ranking = [...sellers]
    .map((s) => ({
      ...s,
      sold: totalsBySeller[s.id]?.total || 0,
      units: totalsBySeller[s.id]?.units || 0,
    }))
    .sort((a, b) => b.sold - a.sold)

  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <h1 className="font-display text-3xl silver-text">Resumen general</h1>
        <p className="text-nina-mute text-sm mt-1">
          Estado del inventario y desempeño del equipo NINA en la feria.
        </p>
      </motion.div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={Banknote}
          label="Ventas totales"
          value={fmtCOP(totals.total)}
          trend={`${totals.count} transacciones`}
          delay={0}
        />
        <StatCard
          icon={ShoppingBag}
          label="Unidades vendidas"
          value={fmtNumber(totals.units)}
          trend="Acumulado feria"
          delay={0.05}
        />
        <StatCard
          icon={Package}
          label="Stock disponible"
          value={fmtNumber(stockUnits)}
          trend={`${products.length} referencias`}
          delay={0.1}
        />
        <StatCard
          icon={Users}
          label="Vendedoras activas"
          value={fmtNumber(sellers.length)}
          trend={`Valor inventario ${fmtCOP(inventoryValue)}`}
          delay={0.15}
        />
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="panel p-6 lg:col-span-2"
        >
          <div className="flex items-center justify-between mb-5">
            <h2 className="font-display text-xl silver-text">Top vendedoras</h2>
            <TrendingUp className="w-4 h-4 text-nina-silver" />
          </div>
          {ranking.length === 0 ? (
            <p className="text-nina-mute text-sm">Aún no hay vendedoras registradas.</p>
          ) : (
            <ul className="space-y-5">
              {ranking.map((s, i) => (
                <motion.li
                  key={s.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.05 * i }}
                  className="flex items-center gap-4"
                >
                  <div className="w-9 h-9 rounded-full grid place-items-center bg-silver-gradient text-nina-black font-bold text-xs shadow-chrome">
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2 mb-1.5">
                      <span className="font-medium truncate">{s.name}</span>
                      <span className="silver-text font-semibold text-sm">
                        {fmtCOP(s.sold)}
                      </span>
                    </div>
                    <ProgressBar value={s.sold} goal={s.goal || 1} showLabels={false} height="h-2" />
                  </div>
                </motion.li>
              ))}
            </ul>
          )}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="panel p-6"
        >
          <h2 className="font-display text-xl silver-text mb-5">Últimas ventas</h2>
          {sales.length === 0 ? (
            <p className="text-nina-mute text-sm">
              Todavía no hay ventas registradas. Cuando una vendedora cargue su primera venta
              aparecerá aquí.
            </p>
          ) : (
            <ul className="space-y-3">
              {sales.slice(0, 6).map((s) => (
                <li key={s.id} className="flex items-start justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{s.productName}</div>
                    <div className="text-xs text-nina-mute">
                      {s.sellerName} · talla {s.size} · {fmtDate(s.soldAt)}
                    </div>
                  </div>
                  <span className="silver-text font-semibold whitespace-nowrap">
                    {fmtCOP(s.total)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </motion.div>
      </div>
    </div>
  )
}
