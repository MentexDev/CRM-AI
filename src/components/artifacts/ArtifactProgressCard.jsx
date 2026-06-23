import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { AlertCircle, CheckCircle2, ChevronRight, Clock, Loader2, Sparkles } from 'lucide-react'

// Tarjeta de CREACIÓN EN CURSO (estilo NeuralOS, diseño NINA): cabecera (agente + acción actual),
// contador "X / N" y checklist de pasos con estado (en curso=spinner, pendiente=reloj, hecho=check).
// `steps` ya viene normalizado: [{ label, status: 'done'|'active'|'error'|'pending' }].
export default function ArtifactProgressCard({ agentName, steps = [], done = 0, total = 0, subtitle, live = false }) {
  const [open, setOpen] = useState(live)
  // Expandida mientras trabaja; se colapsa al terminar (solo reacciona a `live`, no pisa el toggle manual).
  useEffect(() => {
    setOpen(live)
  }, [live])
  if (!steps.length) return null
  const ok = steps.filter((s) => s.status === 'done').length
  const hasError = steps.some((s) => s.status === 'error')
  const allOk = total > 0 && ok === total
  const HeadIcon = live ? Loader2 : allOk ? CheckCircle2 : hasError ? AlertCircle : Sparkles
  const headTone = live
    ? 'bg-silver-gradient text-nina-black'
    : allOk
      ? 'bg-emerald-500/15 text-emerald-300'
      : hasError
        ? 'bg-red-500/15 text-red-300'
        : 'bg-silver-gradient text-nina-black'

  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="panel overflow-hidden w-full max-w-[440px]">
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left">
        <span className={`w-7 h-7 grid place-items-center rounded-lg shrink-0 ${headTone}`}>
          <HeadIcon className={`w-4 h-4 ${live ? 'animate-spin' : ''}`} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-nina-chrome truncate">
            {live ? `${agentName || 'Agente'} está trabajando…` : agentName || 'Proceso'}
          </div>
          {subtitle && <div className="text-[11px] text-nina-mute truncate">{subtitle}</div>}
        </div>
        <span className="shrink-0 text-[11px] font-medium text-nina-mute px-2 py-0.5 rounded-full bg-nina-line/40 tabular-nums">
          {done} / {total}
        </span>
        <ChevronRight className={`w-3.5 h-3.5 text-nina-mute/60 shrink-0 transition ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <ol className="px-3.5 pb-3 pt-1 space-y-2 border-t border-nina-line/40">
          {steps.map((s, i) => (
            <li key={i} className="flex items-center gap-2.5 text-[12.5px]">
              <StatusIcon status={s.status} />
              <span
                className={
                  s.status === 'done'
                    ? 'text-nina-chrome'
                    : s.status === 'active'
                      ? 'text-nina-chrome font-medium'
                      : s.status === 'error'
                        ? 'text-red-300'
                        : 'text-nina-mute'
                }
              >
                {s.label}
              </span>
            </li>
          ))}
        </ol>
      )}
    </motion.div>
  )
}

function StatusIcon({ status }) {
  if (status === 'done') return <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
  if (status === 'active') return <Loader2 className="w-4 h-4 text-nina-silver animate-spin shrink-0" />
  if (status === 'error') return <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
  return <Clock className="w-4 h-4 text-nina-mute/60 shrink-0" />
}
