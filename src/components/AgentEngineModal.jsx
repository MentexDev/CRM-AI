import { useCallback, useEffect, useState } from 'react'
import { Cpu, Loader2, Sparkles, AlertTriangle, RotateCcw, History } from 'lucide-react'
import Modal from './Modal'
import { useAgentEngine } from '../hooks/useAgentEngine'

const DEFAULT_DIRECTIVE =
  'Quiero impulsar las ventas de NINA para el Día de la Madre con una mini-campaña de contenido.'

// Tiempo relativo corto ("hace 5 min", "ayer", "10 jun").
function relTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const diff = (Date.now() - d.getTime()) / 1000
  if (diff < 60) return 'ahora'
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })
}

const STATUS_DOT = {
  running: 'bg-amber-400 animate-pulse',
  done: 'bg-emerald-400',
  error: 'bg-red-400',
}

// Lanza una corrida del motor agéntico (CrewAI en la nube), muestra el resultado
// y el historial de corridas pasadas (persistidas en agent_runs).
export default function AgentEngineModal({ open, onClose }) {
  const { configured, status, result, error, runId, run, reset, listRuns, openRun } = useAgentEngine()
  const [directive, setDirective] = useState(DEFAULT_DIRECTIVE)
  const [elapsed, setElapsed] = useState(0)
  const [history, setHistory] = useState([])

  const refreshHistory = useCallback(async () => {
    setHistory(await listRuns(8))
  }, [listRuns])

  // Cargar historial al abrir y cada vez que una corrida termina.
  useEffect(() => {
    if (open) refreshHistory()
  }, [open, refreshHistory])
  useEffect(() => {
    if (status === 'done' || status === 'error') refreshHistory()
  }, [status, refreshHistory])

  // Contador de segundos mientras corre.
  useEffect(() => {
    if (status !== 'running') return
    setElapsed(0)
    const t = setInterval(() => setElapsed((e) => e + 1), 1000)
    return () => clearInterval(t)
  }, [status])

  const submit = (e) => {
    e.preventDefault()
    if (directive.trim() && status !== 'running') run(directive.trim())
  }

  const openHistoryRun = (h) => {
    setDirective(h.directive)
    openRun(h)
  }

  const running = status === 'running'

  return (
    <Modal open={open} onClose={onClose} title="Motor agéntico · nube" maxWidth="max-w-2xl">
      <div className="space-y-4">
        <div className="flex items-start gap-2.5 text-[12px] text-nina-mute">
          <Cpu className="w-4 h-4 mt-0.5 shrink-0 text-nina-chrome" />
          <p>
            Ejecuta el equipo real en la nube: el <b className="text-nina-chrome">CEO</b> delega en el
            {' '}<b className="text-nina-chrome">Brand Manager de NINA</b>, que consulta el Brain y su
            memoria, registra tareas y pide aprobaciones; el{' '}
            <b className="text-nina-chrome">Creador</b> produce las piezas.
          </p>
        </div>

        {!configured && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-200">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            Supabase no está configurado en el frontend.
          </div>
        )}

        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="label">Directiva de la Junta</label>
            <textarea
              value={directive}
              onChange={(e) => setDirective(e.target.value)}
              className="input min-h-[88px] resize-y"
              placeholder="Ej: Lanza una promo de NINA para San Valentín…"
              disabled={running}
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-nina-mute">
              {runId ? `run ${runId.slice(0, 8)}…` : 'Una corrida tarda ~2–4 min'}
            </span>
            <div className="flex items-center gap-2">
              {(status === 'done' || status === 'error') && (
                <button type="button" onClick={reset} className="btn-ghost text-sm flex items-center gap-1.5">
                  <RotateCcw className="w-3.5 h-3.5" /> Otra
                </button>
              )}
              <button
                type="submit"
                disabled={running || !configured || !directive.trim()}
                className="btn-primary text-sm flex items-center gap-1.5"
              >
                {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {running ? 'Ejecutando…' : 'Ejecutar'}
              </button>
            </div>
          </div>
        </form>

        {/* Estado / resultado */}
        {running && (
          <div className="flex items-center gap-2 rounded-lg border border-nina-line bg-nina-ink/40 px-3 py-2.5 text-[12px] text-nina-mute">
            <Loader2 className="w-4 h-4 animate-spin shrink-0" />
            <span>
              El equipo está trabajando en la nube… <b className="text-nina-chrome">{elapsed}s</b>
              {' '}(suele tardar 2–4 min; puedes cerrar, la corrida sigue).
            </span>
          </div>
        )}

        {status === 'error' && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-[12px] text-red-200 whitespace-pre-wrap">
            {error}
          </div>
        )}

        {status === 'done' && (
          <div className="space-y-1.5">
            <div className="text-[11px] uppercase tracking-[0.2em] text-nina-mute">Resultado</div>
            <div className="max-h-[38vh] overflow-y-auto rounded-lg border border-nina-line bg-nina-ink/40 px-3 py-2.5 text-[13px] text-nina-chrome whitespace-pre-wrap leading-relaxed">
              {result}
            </div>
          </div>
        )}

        {/* Historial de corridas */}
        {history.length > 0 && (
          <div className="space-y-1.5 pt-1">
            <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.2em] text-nina-mute">
              <History className="w-3.5 h-3.5" /> Historial
            </div>
            <div className="rounded-lg border border-nina-line divide-y divide-nina-line/60 overflow-hidden">
              {history.map((h) => (
                <button
                  key={h.id}
                  onClick={() => openHistoryRun(h)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition hover:bg-nina-line/30 ${
                    h.id === runId ? 'bg-nina-line/30' : ''
                  }`}
                  title={h.directive}
                >
                  <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[h.status] ?? 'bg-nina-mute'}`} />
                  <span className="flex-1 min-w-0 truncate text-[12.5px] text-nina-chrome">{h.directive}</span>
                  <span className="shrink-0 text-[11px] text-nina-mute">{relTime(h.created_at)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
