// Íconos para las SECCIONES de un módulo publicado (para que el menú del sidebar se lea como una app
// real, no como "Seccion 1/2/3"). Cada sección puede guardar `icon` (una clave de SECTION_ICONS); si no
// la tiene, se sugiere automáticamente por el título (suggestIcon).
import {
  Table2,
  FileText,
  Wallet,
  Calendar,
  ListChecks,
  Users,
  TrendingUp,
  Target,
  BookOpen,
  Package,
  Megaphone,
  Briefcase,
  Clipboard,
  BarChart3,
  Lightbulb,
  Settings,
} from 'lucide-react'

export const SECTION_ICONS = {
  table: Table2,
  doc: FileText,
  money: Wallet,
  calendar: Calendar,
  checklist: ListChecks,
  users: Users,
  sales: TrendingUp,
  target: Target,
  guide: BookOpen,
  inventory: Package,
  marketing: Megaphone,
  business: Briefcase,
  notes: Clipboard,
  report: BarChart3,
  ideas: Lightbulb,
  settings: Settings,
}
export const SECTION_ICON_KEYS = Object.keys(SECTION_ICONS)

// Etiqueta legible por ícono (para el picker del modal).
export const SECTION_ICON_LABEL = {
  table: 'Tabla',
  doc: 'Documento',
  money: 'Dinero',
  calendar: 'Calendario',
  checklist: 'Lista / tareas',
  users: 'Personas',
  sales: 'Ventas',
  target: 'Metas',
  guide: 'Guía',
  inventory: 'Inventario',
  marketing: 'Marketing',
  business: 'Negocio',
  notes: 'Notas',
  report: 'Reporte',
  ideas: 'Ideas',
  settings: 'Ajustes',
}

// Sugerencia de ícono por el título de la sección (defaults inteligentes para módulos ya sembrados).
export function suggestIcon(title = '', kind = '') {
  const t = String(title).toLowerCase()
  if (/gu[ií]a|instruc|ayuda|manual|c[oó]mo usar/.test(t)) return 'guide'
  if (/gasto|presupuesto|dinero|pago|finanz|movimiento|monto|factura/.test(t)) return 'money'
  if (/calendario|fecha|agenda|publicaci|cronograma/.test(t)) return 'calendar'
  if (/checklist|check|tarea|pendiente|ingreso de/.test(t)) return 'checklist'
  if (/cliente|empleado|persona|equipo|contacto|onboarding/.test(t)) return 'users'
  if (/venta|oportunidad|pipeline|negociaci/.test(t)) return 'sales'
  if (/meta|objetivo|kpi/.test(t)) return 'target'
  if (/idea|brainstorm|banco/.test(t)) return 'ideas'
  if (/resumen|reporte|dashboard|indicador/.test(t)) return 'report'
  if (/inventar|stock|producto/.test(t)) return 'inventory'
  if (/marketing|tono|marca|campa/.test(t)) return 'marketing'
  if (/documento|requerido|plan/.test(t)) return 'doc'
  if (kind === 'sheet') return 'table'
  if (kind === 'board') return 'notes'
  if (kind === 'slides') return 'business'
  return 'doc'
}

// Componente de ícono para una sección (usa su `icon` guardado, o lo sugiere por el título).
export function sectionIconComp(section) {
  return SECTION_ICONS[section?.icon] || SECTION_ICONS[suggestIcon(section?.title, section?.kind)] || FileText
}
