import { motion } from 'framer-motion'

export default function StatCard({ icon: Icon, label, value, trend, delay = 0 }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay }}
      className="panel panel-hover p-5 group"
    >
      <div className="flex items-center justify-between mb-3">
        <span className="label mb-0">{label}</span>
        {Icon && (
          <div className="p-2 rounded-lg bg-nina-line/60 border border-nina-line group-hover:border-nina-silver/30 transition">
            <Icon className="w-4 h-4 text-nina-silver" />
          </div>
        )}
      </div>
      <div className="silver-text font-display font-semibold text-3xl">{value}</div>
      {trend && <div className="text-xs text-nina-mute mt-1">{trend}</div>}
    </motion.div>
  )
}
