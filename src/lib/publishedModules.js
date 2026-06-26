// Deriva las secciones de un módulo publicado: usa `sections` si las tiene; si es un módulo viejo
// (sections=[]), crea una sección única desde las columnas kind/data (compatibilidad hacia atrás).
export function moduleSections(mod) {
  if (!mod) return []
  if (Array.isArray(mod.sections) && mod.sections.length) return mod.sections
  return [{ id: 'main', title: mod.title, kind: mod.kind, data: mod.data || {} }]
}
