import { motion } from 'framer-motion'
import { fmtCOP } from '../lib/format'

export default function ProgressBar({ value, goal, showLabels = true, height = 'h-3' }) {
  const pct = goal > 0 ? Math.min(100, (value / goal) * 100) : 0
  return (
    <div className="w-full">
      {showLabels && (
        <div className="flex justify-between items-baseline mb-2 text-xs">
          <span className="text-nina-mute uppercase tracking-[0.18em]">Progreso</span>
          <span className="silver-text font-semibold">{pct.toFixed(0)}%</span>
        </div>
      )}
      <div className={`relative w-full ${height} rounded-full bg-nina-line overflow-hidden`}>
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 1, ease: 'easeOut' }}
          className="h-full rounded-full relative"
          style={{
            background:
              'linear-gradient(90deg, #ffffff 0%, #c8c8c8 35%, #8a8a8a 50%, #c8c8c8 65%, #ffffff 100%)',
            backgroundSize: '200% 100%',
          }}
        >
          <div
            className="absolute inset-0 animate-shimmer"
            style={{
              background:
                'linear-gradient(110deg, transparent 35%, rgba(255,255,255,0.55) 50%, transparent 65%)',
              backgroundSize: '200% 100%',
            }}
          />
        </motion.div>
      </div>
      {showLabels && (
        <div className="flex justify-between mt-2 text-xs">
          <span className="text-nina-chrome font-medium">{fmtCOP(value)}</span>
          <span className="text-nina-mute">Meta {fmtCOP(goal)}</span>
        </div>
      )}
    </div>
  )
}
