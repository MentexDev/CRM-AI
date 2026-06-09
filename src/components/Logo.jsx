import { motion } from 'framer-motion'

export default function Logo({ size = 'md', subtitle = true, text = false }) {
  const heights = {
    sm: 'h-7',
    md: 'h-10',
    lg: 'h-16',
    xl: 'h-24',
  }
  const textSizes = {
    sm: 'text-lg',
    md: 'text-2xl',
    lg: 'text-4xl',
    xl: 'text-7xl',
  }
  const subSizes = {
    sm: 'text-[9px]',
    md: 'text-[10px]',
    lg: 'text-xs',
    xl: 'text-sm',
  }

  return (
    <div className="flex flex-col items-center select-none">
      {text ? (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className={`silver-text-static font-display font-bold tracking-[0.18em] ${textSizes[size] || textSizes.md}`}
        >
          CRM · AI
        </motion.div>
      ) : (
        <motion.img
          src="/logo-crm.png"
          alt="CRM · AI"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className={`${heights[size] || heights.md} w-auto object-contain`}
        />
      )}
      {subtitle && (
        <motion.span
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2, duration: 0.6 }}
          className={`text-nina-mute uppercase tracking-[0.45em] mt-1.5 ${subSizes[size] || subSizes.md}`}
        >
          Mentex Holding
        </motion.span>
      )}
    </div>
  )
}
