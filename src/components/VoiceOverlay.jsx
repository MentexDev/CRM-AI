// VoiceOverlay — UI compacta para el estado de transcripción por voz.
// Se monta encima del composer cuando voice.status !== 'idle'.
// Muestra:
//   - Estado (Escuchando / Pausa / Procesando)
//   - Waveform reactiva al micro (driven por refs + RAF, sin re-renders)
//   - Idioma detectado
//   - Botones: pausa/reanudar, deshacer último segmento, detener
import { useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { Mic, MicOff, Pause, Play, Undo2, X } from 'lucide-react'

const BAR_COUNT = 24

function LiveWaveform({ getAudioLevels, active }) {
  const barsRef = useRef([])
  const rafRef = useRef(0)

  useEffect(() => {
    if (!active) {
      barsRef.current.forEach((b) => {
        if (b) b.style.height = '3px'
      })
      return
    }
    const loop = () => {
      const levels = getAudioLevels()
      barsRef.current.forEach((bar, i) => {
        if (!bar) return
        const lv = levels[Math.floor((i * levels.length) / BAR_COUNT)] ?? 0.04
        const h = Math.max(3, Math.round(lv * 24))
        bar.style.height = `${h}px`
        bar.style.opacity = String(Math.max(0.35, Math.min(1, 0.35 + lv * 1.4)))
      })
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafRef.current)
  }, [active, getAudioLevels])

  return (
    <div className="flex items-center gap-[2px]" style={{ height: '28px' }}>
      {Array.from({ length: BAR_COUNT }, (_, i) => (
        <div
          key={i}
          ref={(el) => {
            if (el) barsRef.current[i] = el
          }}
          style={{
            width: '3px',
            height: '3px',
            borderRadius: '2px',
            backgroundColor: 'rgb(232, 232, 232)',
            transition: 'height 60ms ease, opacity 60ms ease',
            transform:
              i < BAR_COUNT / 2
                ? `scaleY(${0.6 + (i / (BAR_COUNT / 2)) * 0.4})`
                : `scaleY(${0.6 + ((BAR_COUNT - i) / (BAR_COUNT / 2)) * 0.4})`,
            transformOrigin: 'center',
          }}
        />
      ))}
    </div>
  )
}

const STATUS_TEXT = {
  listening: 'Escuchando…',
  paused: 'En pausa',
  processing: 'Procesando…',
  unsupported: 'No soportado',
  idle: '',
}

export default function VoiceOverlay({ voice }) {
  if (voice.status === 'idle' || voice.status === 'unsupported') return null

  const isListening = voice.status === 'listening'
  const isPaused = voice.status === 'paused'
  const langShort = voice.detectedLang === 'es' ? 'ES' : voice.detectedLang === 'en' ? 'EN' : 'ES/EN'

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.18 }}
      className="mb-2 rounded-xl border border-nina-line bg-nina-panel/80 px-3 py-2 flex items-center gap-3"
    >
      <div className="relative shrink-0">
        <div className={`w-7 h-7 rounded-full grid place-items-center ${isListening ? 'bg-red-500/20 text-red-300' : 'bg-nina-line/40 text-nina-mute'}`}>
          {isListening ? <Mic className="w-3.5 h-3.5" /> : <MicOff className="w-3.5 h-3.5" />}
        </div>
        {isListening && (
          <span className="absolute inset-0 rounded-full border border-red-400/50 animate-ping" />
        )}
      </div>
      <div className="flex-1 min-w-0 flex items-center gap-3">
        <LiveWaveform getAudioLevels={voice.getAudioLevels} active={isListening} />
        <div className="leading-tight">
          <div className="text-[11px] text-nina-chrome font-medium">{STATUS_TEXT[voice.status]}</div>
          <div className="text-[9px] text-nina-mute uppercase tracking-[0.15em]">{langShort} · {voice.wordCount}p</div>
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {voice.canUndo && (
          <button
            type="button"
            onClick={voice.undoLastSegment}
            className="w-7 h-7 grid place-items-center rounded-lg text-nina-mute hover:text-nina-chrome hover:bg-nina-line/40 transition"
            title="Deshacer último segmento"
            aria-label="Deshacer"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
        )}
        {isListening ? (
          <button
            type="button"
            onClick={voice.pauseListening}
            className="w-7 h-7 grid place-items-center rounded-lg text-nina-mute hover:text-nina-chrome hover:bg-nina-line/40 transition"
            title="Pausar"
            aria-label="Pausar"
          >
            <Pause className="w-3.5 h-3.5" />
          </button>
        ) : isPaused ? (
          <button
            type="button"
            onClick={voice.resumeListening}
            className="w-7 h-7 grid place-items-center rounded-lg text-emerald-300 hover:bg-nina-line/40 transition"
            title="Reanudar"
            aria-label="Reanudar"
          >
            <Play className="w-3.5 h-3.5" />
          </button>
        ) : null}
        <button
          type="button"
          onClick={voice.stopListening}
          className="w-7 h-7 grid place-items-center rounded-lg text-nina-mute hover:text-red-300 hover:bg-nina-line/40 transition"
          title="Detener"
          aria-label="Detener"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </motion.div>
  )
}
