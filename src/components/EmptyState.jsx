import { motion } from 'framer-motion'

export default function EmptyState({
  icon: Icon,
  title,
  description,
  actions,
  compact = false,
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`panel flex flex-col items-center text-center ${
        compact ? 'p-8' : 'p-12'
      }`}
    >
      {Icon && (
        <div
          className={`grid place-items-center rounded-full border border-nina-line bg-nina-ink mb-4 ${
            compact ? 'w-12 h-12' : 'w-16 h-16'
          }`}
        >
          <Icon
            className={`text-nina-silver ${compact ? 'w-5 h-5' : 'w-7 h-7'}`}
            aria-hidden
          />
        </div>
      )}
      <h3 className="font-display text-xl silver-text mb-2">{title}</h3>
      {description && (
        <p className="text-sm text-nina-mute max-w-md mb-5">{description}</p>
      )}
      {actions && <div className="flex flex-wrap gap-2 justify-center">{actions}</div>}
    </motion.div>
  )
}
