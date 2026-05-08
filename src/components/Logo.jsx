import { motion } from 'framer-motion'

export default function Logo({ size = 'md', subtitle = true }) {
  const sizes = {
    sm: { w: 'text-lg', s: 'text-[9px]' },
    md: { w: 'text-2xl', s: 'text-[10px]' },
    lg: { w: 'text-4xl', s: 'text-xs' },
    xl: { w: 'text-7xl', s: 'text-sm' },
  }
  const sz = sizes[size] || sizes.md
  return (
    <div className="flex flex-col items-center select-none">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        className={`silver-text-static font-display font-bold tracking-[0.18em] ${sz.w}`}
      >
        CRM · AI
      </motion.div>
      {subtitle && (
        <motion.span
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2, duration: 0.6 }}
          className={`text-nina-mute uppercase tracking-[0.45em] mt-1 ${sz.s}`}
        >
          Mentex Holding
        </motion.span>
      )}
    </div>
  )
}
