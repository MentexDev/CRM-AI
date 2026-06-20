// Casos de evaluación de los agentes del CRM.
//
// Cada caso: { name, agent (slug), message, force_tool?, expect: [aserciones] }
// Las aserciones se arman con los helpers de abajo; reciben el "transcript" del turno
// (lo que el agente realmente hizo) y devuelven pass/fail.
//
// REGLA para que los casos no sean inestables (los LLM no son deterministas): usa
// instrucciones DIRECTIVAS ("usa tu herramienta de documento para…") y asercones
// ROBUSTAS (que tal herramienta esté ENTRE las llamadas, que exista tal artefacto),
// no comparaciones exactas de texto libre.

// ---- helpers de aserción ----
export const httpOk = () => ({ label: 'responde sin error (HTTP 200)', check: (t) => t.status === 200 && !t.error })
export const replied = () => ({ label: 'produce una respuesta no vacía', check: (t) => t.reply.trim().length > 0 })
export const calledTool = (name) => ({ label: `usa la herramienta "${name}"`, check: (t) => t.calledTools.includes(name) })
export const didNotCallTool = (name) => ({ label: `NO usa la herramienta "${name}"`, check: (t) => !t.calledTools.includes(name) })
export const producedArtifact = (kind) => ({ label: `produce un artefacto "${kind}"`, check: (t) => t.artifacts.includes(kind) })
export const producedNoArtifact = () => ({ label: 'no produce artefactos de canvas', check: (t) => t.artifacts.length === 0 })
export const replyMatches = (re) => ({ label: `la respuesta coincide con ${re}`, check: (t) => re.test(t.reply) })
export const replyNotMatches = (re) => ({ label: `la respuesta NO coincide con ${re}`, check: (t) => !re.test(t.reply) })

export const CASES = [
  // --- Smoke: el agente responde. Atrapa "se cayó", provider mal configurado, 500. ---
  // Un caso por provider distinto para detectar si una llave/proveedor se rompe.
  {
    name: 'creador-smoke',
    agent: 'creador-de-contenido', // openrouter/kimi
    message: 'Hola, en una sola frase: ¿en qué me puedes ayudar?',
    expect: [httpOk(), replied()],
  },
  {
    name: 'ceo-smoke',
    agent: 'ceo-global', // groq/llama — otro proveedor
    message: 'En una sola frase, ¿cuál es tu rol?',
    expect: [httpOk(), replied()],
  },
  {
    name: 'inventarista-crm-smoke',
    agent: 'inventarista-crm',
    message: 'En una frase, ¿qué reportas?',
    expect: [httpOk(), replied()],
  },

  // --- Artefactos: que el agente ELIJA la herramienta correcta y produzca el tipo esperado. ---
  // Nota: agregamos "sin hacerme preguntas, inventa el contenido" para que el agente NO entre a su
  // rama de aclaración (ask_questions) y el eval mida lo que queremos (que produce el artefacto),
  // no su decisión de pedir detalles.
  {
    name: 'creador-genera-documento',
    agent: 'creador-de-contenido',
    message: 'Sin hacerme preguntas, inventa el contenido y usa tu herramienta de documento para escribirme un texto corto (3 viñetas) con ideas de contenido para el Instagram de NINA.',
    expect: [httpOk(), calledTool('draft_document'), producedArtifact('document')],
  },
  {
    name: 'creador-genera-presentacion',
    agent: 'creador-de-contenido',
    message: 'Sin hacerme preguntas, inventa el contenido y usa tu herramienta de presentación para armar 3 diapositivas sobre la nueva colección de NINA.',
    expect: [httpOk(), calledTool('draft_slides'), producedArtifact('slides')],
  },
  {
    name: 'creador-genera-hoja',
    agent: 'creador-de-contenido',
    message: 'Sin hacerme preguntas, inventa el contenido y usa tu herramienta de hoja de cálculo para una tabla con 2 columnas (producto, precio) y 3 filas de ejemplo de NINA.',
    expect: [httpOk(), calledTool('draft_sheet'), producedArtifact('sheet')],
  },

  // --- Guardrail: un agradecimiento casual NO debe disparar artefactos de canvas. ---
  {
    name: 'creador-saludo-sin-artefactos',
    agent: 'creador-de-contenido',
    message: 'Listo, ¡muchas gracias! Eso era todo por ahora.',
    expect: [httpOk(), replied(), producedNoArtifact()],
  },
]
