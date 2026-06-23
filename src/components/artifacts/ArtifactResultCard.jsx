import { motion } from 'framer-motion'
import { AlertTriangle, Download, ExternalLink, Eye } from 'lucide-react'
import { artifactPreview, kindMeta } from '../../lib/artifactKinds'

// Tarjeta del ARTEFACTO FINAL en el hilo del chat (estilo NeuralOS, diseño NINA).
// Cabecera tipada (etiqueta + meta '· N palabras · generado por AGENTE') + preview + acciones.
// Reusa el molde estructural de AssetCard (Biblioteca) y abre/descarga con los flujos ya existentes.
export default function ArtifactResultCard({ artifact, agentName, onOpen, onDownload }) {
  if (!artifact) return null
  const m = kindMeta(artifact.type)
  const Icon = m.Icon
  const title = artifact.title || artifact.subject || m.label
  const { meta, snippet } = artifactPreview(artifact)
  const isImage = artifact.type === 'image'
  const isEmail = artifact.type === 'email'

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="panel overflow-hidden w-full max-w-[440px]"
    >
      {/* Cabecera: tipo + meta + autor */}
      <div className="flex items-center gap-2.5 px-3.5 py-2.5 border-b border-nina-line/50">
        <span className="w-7 h-7 grid place-items-center rounded-lg bg-silver-gradient text-nina-black shrink-0">
          <Icon className="w-4 h-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[10.5px]">
            <span className={`uppercase tracking-wide font-semibold ${m.color}`}>{m.label}</span>
            {meta && (
              <>
                <span className="text-nina-mute/40">·</span>
                <span className="text-nina-mute">{meta}</span>
              </>
            )}
          </div>
          {agentName && <div className="text-[10px] text-nina-mute/70 italic truncate">generado por {agentName}</div>}
        </div>
      </div>

      {/* Preview del contenido */}
      {isImage && artifact.url ? (
        <button type="button" onClick={onOpen} className="block w-full bg-nina-ink/50 border-b border-nina-line/40" title="Abrir">
          <img src={artifact.url} alt={title} referrerPolicy="no-referrer" className="w-full max-h-60 object-cover" />
        </button>
      ) : isEmail && artifact.html ? (
        <button type="button" onClick={onOpen} className="relative block w-full h-32 bg-white border-b border-nina-line/40 overflow-hidden" title="Abrir">
          <iframe
            title={title}
            srcDoc={artifact.html}
            sandbox=""
            scrolling="no"
            tabIndex={-1}
            aria-hidden="true"
            className="absolute inset-0 w-full h-full pointer-events-none"
          />
        </button>
      ) : null}

      {/* Cuerpo: título + snippet */}
      <div className="px-3.5 py-3">
        <div className="text-[14px] font-semibold text-nina-chrome leading-snug line-clamp-2">{title}</div>
        {snippet && !isImage && <div className="text-[12px] text-nina-mute mt-1 line-clamp-2 leading-relaxed">{snippet}</div>}
        {artifact.warning && (
          <div className="text-[11px] text-amber-300/90 mt-2 flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{artifact.warning}</span>
          </div>
        )}
      </div>

      {/* Acciones */}
      <div className="flex items-center justify-end gap-1.5 px-3 py-2 border-t border-nina-line/50">
        {onOpen && (
          <button
            type="button"
            onClick={onOpen}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] text-nina-mute hover:text-nina-chrome hover:bg-nina-line/40 transition"
          >
            <Eye className="w-3.5 h-3.5" /> Vista previa
          </button>
        )}
        {onOpen && (
          <button
            type="button"
            onClick={onOpen}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] text-nina-chrome bg-nina-line/30 hover:bg-nina-line/50 border border-nina-line transition"
          >
            <ExternalLink className="w-3.5 h-3.5" /> Abrir
          </button>
        )}
        {onDownload && (
          <button
            type="button"
            onClick={onDownload}
            title="Descargar"
            className="w-8 h-8 grid place-items-center rounded-lg text-nina-mute hover:text-nina-chrome hover:bg-nina-line/40 transition"
          >
            <Download className="w-4 h-4" />
          </button>
        )}
      </div>
    </motion.div>
  )
}
