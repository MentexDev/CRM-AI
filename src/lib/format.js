export const fmtCOP = (n) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(Number(n) || 0)

export const fmtNumber = (n) =>
  new Intl.NumberFormat('es-CO').format(Number(n) || 0)

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
