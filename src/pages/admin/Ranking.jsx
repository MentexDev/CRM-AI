import { motion } from 'framer-motion'
import { Crown, Medal, Trophy } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useData } from '../../context/DataContext'
import ProgressBar from '../../components/ProgressBar'
import EmptyState from '../../components/EmptyState'
import { fmtCOP, fmtNumber, fmtPrizeThreshold } from '../../lib/format'

const podiumIcons = [Crown, Trophy, Medal]

export default function Ranking() {
  const { listSellers } = useAuth()
  const { totalsBySeller, prizes } = useData()
  const sellers = listSellers().filter((s) => s.role === 'seller')

  const ranking = [...sellers]
    .map((s) => ({
      ...s,
      total: totalsBySeller[s.id]?.total || 0,
      units: totalsBySeller[s.id]?.units || 0,
      count: totalsBySeller[s.id]?.count || 0,
    }))
    .sort((a, b) => b.total - a.total)

  const top3 = ranking.slice(0, 3)
  const rest = ranking.slice(3)

  if (sellers.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-3xl silver-text">Ranking de vendedoras</h1>
          <p className="text-nina-mute text-sm mt-1">
            Premios desbloqueables por meta de ventas.
          </p>
        </div>
        <EmptyState
          icon={Trophy}
          title="Aún no hay vendedoras para rankear"
          description="Cuando crees vendedoras y comiencen a registrar ventas, aquí verás el podio y los premios desbloqueados."
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl silver-text">Ranking de vendedoras</h1>
        <p className="text-nina-mute text-sm mt-1">
          Premios desbloqueables por meta de ventas. ¡Vamos por todas! ✨
        </p>
      </div>

      <div className="grid sm:grid-cols-3 gap-4">
        {top3.map((s, i) => {
          const Icon = podiumIcons[i]
          return (
            <motion.div
              key={s.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
              className={`panel p-6 relative overflow-hidden ${
                i === 0 ? 'sm:scale-[1.03] ring-1 ring-nina-silver/30' : ''
              }`}
            >
              <div
                aria-hidden
                className="absolute -top-20 -right-20 w-48 h-48 rounded-full opacity-30 blur-3xl"
                style={{
                  background:
                    i === 0
                      ? 'radial-gradient(circle, rgba(232,232,232,0.5), transparent 70%)'
                      : 'radial-gradient(circle, rgba(200,200,200,0.25), transparent 70%)',
                }}
              />
              <div className="flex items-center gap-3 mb-4 relative">
                <div className="w-14 h-14 rounded-full grid place-items-center bg-silver-gradient text-nina-black font-bold shadow-chrome">
                  {s.avatar}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] uppercase tracking-[0.25em] text-nina-mute flex items-center gap-1">
                    <Icon className="w-3 h-3" /> Puesto {i + 1}
                  </div>
                  <div className="font-display text-lg truncate">{s.name}</div>
                </div>
              </div>
              <div className="silver-text font-display text-3xl font-bold mb-1">
                {fmtCOP(s.total)}
              </div>
              <div className="text-xs text-nina-mute mb-4">
                {fmtNumber(s.units)} unidades · {fmtNumber(s.count)} ventas
              </div>
              <ProgressBar value={s.total} goal={s.goal || 1} showLabels={false} />
            </motion.div>
          )
        })}
      </div>

      {rest.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="panel p-5"
        >
          <ul className="space-y-4">
            {rest.map((s, i) => (
              <li key={s.id} className="flex items-center gap-4">
                <div className="w-9 h-9 rounded-full grid place-items-center bg-nina-line text-nina-silver font-bold text-xs">
                  {i + 4}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2 mb-1.5">
                    <span className="font-medium truncate">{s.name}</span>
                    <span className="silver-text font-semibold text-sm">{fmtCOP(s.total)}</span>
                  </div>
                  <ProgressBar value={s.total} goal={s.goal || 1} showLabels={false} height="h-2" />
                </div>
              </li>
            ))}
          </ul>
        </motion.div>
      )}

      {prizes.length > 0 && (
      <div className="panel p-6">
        <h2 className="font-display text-xl silver-text mb-4">Premios por meta</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {prizes.map((p, i) => (
            <motion.div
              key={p.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 * i }}
              className="rounded-xl border border-nina-line bg-nina-ink p-4"
            >
              <div className="text-2xl mb-2">{p.icon}</div>
              <div className="text-xs uppercase tracking-[0.2em] text-nina-mute mb-1">
                {(p.type || 'amount') === 'units' ? 'Al vender' : 'Al alcanzar'}{' '}
                {fmtPrizeThreshold(p)}
              </div>
              <div className="font-medium text-nina-chrome">{p.name}</div>
            </motion.div>
          ))}
        </div>
      </div>
      )}
    </div>
  )
}
