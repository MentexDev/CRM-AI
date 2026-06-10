export const fmtCOP = (n) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(Number(n) || 0)

export const fmtNumber = (n) =>
  new Intl.NumberFormat('es-CO').format(Number(n) || 0)

export const formatBytes = (bytes) => {
  const n = Number(bytes) || 0
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export const formatTimeAgo = (ts) => {
  if (!ts) return ''
  const d = new Date(ts)
  const diff = (Date.now() - d.getTime()) / 1000
  if (diff < 60) return 'hace un momento'
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`
  if (diff < 86400 * 7) return `hace ${Math.floor(diff / 86400)} d`
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })
}

export const fmtDate = (d) =>
  new Intl.DateTimeFormat('es-CO', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(d))

export const totalStock = (sizes) =>
  Object.values(sizes || {}).reduce((a, b) => a + Number(b || 0), 0)

export const stockStatus = (qty) => {
  if (qty <= 0) return 'out'
  if (qty <= 5) return 'low'
  return 'ok'
}

// Premios: progreso según el tipo de meta
// stats = { total: COP vendido, units: unidades vendidas }
export const prizeProgress = (prize, stats) => {
  const type = prize.type || 'amount'
  const current = type === 'units' ? stats.units || 0 : stats.total || 0
  const threshold = Number(prize.threshold) || 0
  const unlocked = threshold > 0 && current >= threshold
  const remaining = Math.max(0, threshold - current)
  return { type, current, threshold, unlocked, remaining }
}

export const fmtPrizeThreshold = (prize) =>
  (prize.type || 'amount') === 'units'
    ? `${fmtNumber(prize.threshold)} ${Number(prize.threshold) === 1 ? 'unidad' : 'unidades'}`
    : fmtCOP(prize.threshold)

export const fmtPrizeRemaining = (prize, stats) => {
  const { type, remaining } = prizeProgress(prize, stats)
  if (remaining === 0) return 'Desbloqueado'
  return type === 'units'
    ? `Te faltan ${fmtNumber(remaining)} ${remaining === 1 ? 'unidad' : 'unidades'}`
    : `Te faltan ${fmtCOP(remaining)}`
}
