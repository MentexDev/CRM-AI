import { Clapperboard, Sparkles } from 'lucide-react'
import EmptyState from '../../components/EmptyState'

// Workspace de Producción — placeholder. El contenido se define en el siguiente paso.
export default function Produccion() {
  return (
    <div className="space-y-5 lg:px-6 lg:pt-4">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-display text-2xl silver-text mb-1 flex items-center gap-2">
            <Clapperboard className="w-5 h-5 text-nina-silver" /> Producción
          </h2>
          <p className="text-sm text-nina-mute">
            Gestión de la producción del holding — por marca y flujo de fabricación.
          </p>
        </div>
      </header>

      <EmptyState
        icon={Sparkles}
        title="Producción · próximamente"
        description="Aquí vivirá la gestión de producción de la empresa: marcas, lotes y cómo se maneja la fabricación. Lo diseñamos juntos cuando definas el flujo."
      />
    </div>
  )
}
