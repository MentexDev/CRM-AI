# Auditoría C-A-R — Drawer de tareas (Fase A, estilo NeuralOS)

Fecha: 2026-06-17 · Feature: `src/pages/admin/Tasks.jsx` (TaskDrawer) + `src/hooks/useTaskActivity.js`.
Auditoría adversarial multi-agente (3 dimensiones: React/hooks, lógica pura, UX/a11y).
**29 hallazgos → 23 confirmados (0 CRIT, 10 IMP), 6 refutados.**

## IMP corregidos (con test de regresión donde aplica)

- **Pérdida silenciosa de texto en `parseTaskBrief` (DL-1, DL-2).** El preámbulo (texto
  antes del primer label) y las descripciones con labels de valor vacío desaparecían de la
  UI. Fix: conservar `preamble` y caer a `raw` si todos los valores están vacíos. Tests.
- **Costo "≈ $0.00" siempre (DL-5/UX-02).** A 0.6 USD/M, toda tarea < ~16.700 tokens
  mostraba $0.00 — parecía roto. Fix: invertir jerarquía (tokens = cifra grande, dato real;
  costo = sub-línea con `<$0.01` cuando es sub-céntimo). `estimateCost()` testeado.
- **Tiempo congelado en tareas vivas (DL-7/UX-11).** `Date.now()` se evaluaba una vez por
  render. Fix: `setInterval` de 30s mientras `in_progress` que fuerza re-render.
- **Tab no se resetea al cambiar de tarea (UX-01).** El drawer nunca se desmonta (solo
  cambia la prop `task`). Fix: `useEffect(()=>setTab('details'), [task?.id])`.
- **Listener de Escape re-suscrito cada render (RH-1).** `onClose` llega como arrow inline
  del padre. Fix: `onCloseRef` + deps `[task]` (no `onClose`).
- **Drawer no accesible como diálogo (UX-03).** Fix: `role="dialog" aria-modal aria-labelledby`
  + foco al panel al abrir (`panelRef` + `useId` para el título).
- **Tabs sin patrón ARIA (UX-10).** Fix: `role="tablist"/tab/tabpanel" + aria-selected`.
- **Error de carga confundido con "sin actividad" (UX-07).** `useTaskActivity` silenciaba
  el error → []. Fix: propagar `error` y mostrar mensaje distinto.
- **Overflow de títulos largos (UX-05).** Fix: `break-words` en el `<h3>`.
- **fmtDuration: 0ms→"—" y sin rama de días (DL-6).** Fix: guard `ms==null/NaN/<0`, +rama días.

## NOTE corregidos (baratos)
- Orden canónico de secciones Objetivo→Contexto→Criterio (DL-3).
- Keys estables del timeline (no índices) (UX-08).
- Código muerto `Section` eliminado (UX-04).
- `live` condicionado a que exista agente (UX-06).

## Meta-lecciones
1. **Extraer la lógica pura del JSX a un módulo `.js`** la vuelve testeable con `deno test`
   (sin React) — el parser, los formateadores y el builder del timeline ahora tienen 10
   tests. Hacerlo ANTES, no después.
2. **Parsers de texto libre: nunca descartar lo que no matchea.** Conservar preámbulo y caer
   a crudo. La pérdida de datos silenciosa es el peor bug de un parser de UI.
3. **Estimaciones cerca de cero engañan.** Mostrar el dato real (tokens) en grande y la
   estimación como sub-línea con umbral (`<$0.01`).
4. **Componente montado permanentemente con prop cambiante** ⇒ el estado local (tab) y los
   efectos (listeners con props inline) necesitan re-sync por `id` o un ref.
5. **Drawer = diálogo:** role/aria/foco/Escape no son opcionales (WCAG).

Build commit: `d57a27c` (feat). Tests: `deno test src/lib/taskDrawer.test.js` → 10 passed.
