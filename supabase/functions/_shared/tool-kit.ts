// =====================================================================
// El Motor · SDK de Tools — primitiva `defineTool()`
// =====================================================================
//
// UNA sola fuente de verdad por tool: el schema que ve el LLM, el handler
// que la ejecuta y sus metadatos (categoría, aprobación, panel de render)
// viven juntos. Esto elimina la DERIVA entre `tools_registry` (BD) y los
// HANDLERS (código) — el bug de "handler sin registro = invisible" y
// "registro sin handler = Tool no implementada".
//
// Además, `ToolRegistry.seedRows()` GENERA las filas de `tools_registry`
// desde el código, para versionar el seed en el repo (hoy vive solo en la BD).
//
// Diseñado para crecer hacia el split-view: cada tool declara `render`, la
// pista de qué panel (browser/doc/preview/code/image/video) abre su resultado.

import type { ToolCallRequest, ToolDefinition } from './llm.ts'
import type { ToolContext, ToolResult } from './tools.ts'

/** Panel del split-view que el resultado de una tool puede abrir/actualizar. */
export type RenderTarget =
  | 'none'
  | 'browser'
  | 'doc'
  | 'preview'
  | 'code'
  | 'sheet'
  | 'image'
  | 'video'

/** Lo que el autor de una tool declara. */
export interface ToolSpec {
  /** snake_case, único. Es el nombre que el LLM invoca. */
  name: string
  /** Qué hace y CUÁNDO usarla (el LLM lo lee para decidir). */
  description: string
  /** Familia para UI/permmisos: knowledge | creative | action | commerce | orchestration | … */
  category: string
  /** JSON Schema de los argumentos (la firma que ve el LLM). */
  parameters: Record<string, unknown>
  /** Si requiere aprobación humana antes de ejecutar efectos sensibles. */
  requiresApproval?: boolean
  /** Pista para el split-view: qué panel abre su resultado. Default 'none'. */
  render?: RenderTarget
  /** Si está activa (puede asignarse a agentes). Default true. */
  isActive?: boolean
  /** La ejecución real. Recibe el contexto del agente y los args parseados. */
  handler: (ctx: ToolContext, args: Record<string, unknown>) => Promise<ToolResult>
}

/** Una tool ya normalizada (con defaults resueltos). */
export interface Tool extends Required<Omit<ToolSpec, 'handler'>> {
  handler: ToolSpec['handler']
}

/** Fila tal cual la espera la tabla `tools_registry` (para el seed versionado). */
export interface ToolRegistryRow {
  name: string
  description: string
  category: string
  args_schema: Record<string, unknown>
  requires_approval: boolean
  is_active: boolean
}

/**
 * Declara una tool. Punto de entrada único del SDK.
 *
 *   export const webSearch = defineTool({
 *     name: 'web_search',
 *     description: 'Busca en la web en tiempo real…',
 *     category: 'knowledge',
 *     parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
 *     async handler(ctx, args) { … return { ok: true, data } },
 *   })
 */
export function defineTool(spec: ToolSpec): Tool {
  if (!/^[a-z][a-z0-9_]*$/.test(spec.name)) {
    throw new Error(`defineTool: nombre inválido "${spec.name}" (usa snake_case)`)
  }
  return {
    name: spec.name,
    description: spec.description,
    category: spec.category,
    parameters: spec.parameters,
    requiresApproval: spec.requiresApproval ?? false,
    render: spec.render ?? 'none',
    isActive: spec.isActive ?? true,
    handler: spec.handler,
  }
}

/**
 * Registro tipado de tools. Reemplaza el `HANDLERS` manual + `loadTools` (BD)
 * + `ToolDescriptor`, manteniéndolos imposibles de desincronizar.
 */
export class ToolRegistry {
  private byName = new Map<string, Tool>()

  constructor(tools: Tool[]) {
    for (const t of tools) {
      if (this.byName.has(t.name)) {
        throw new Error(`ToolRegistry: tool duplicada "${t.name}"`)
      }
      this.byName.set(t.name, t)
    }
  }

  get(name: string): Tool | undefined {
    return this.byName.get(name)
  }

  /** Todas las tools activas, en orden estable. */
  all(): Tool[] {
    return [...this.byName.values()].filter((t) => t.isActive)
  }

  /**
   * Definiciones para el LLM, filtradas a las que el agente tiene permitidas.
   * (Equivale a `loadTools(names)` + `toToolDefinitions(...)` de hoy, pero sin
   * tocar la BD: la fuente es el código.)
   */
  definitions(allowed: string[]): ToolDefinition[] {
    const set = new Set(allowed)
    return this.all()
      .filter((t) => set.has(t.name))
      .map((t) => ({
        type: 'function' as const,
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }))
  }

  /**
   * Ejecuta una tool a partir de un tool_call del LLM. Conserva la defensa
   * de hoy: `"null"`/`"undefined"`/JSON inválido → objeto vacío o error claro.
   */
  async run(ctx: ToolContext, call: ToolCallRequest): Promise<ToolResult> {
    const tool = this.byName.get(call.function.name)
    if (!tool) {
      return { ok: false, error: `Tool no implementada en runtime: ${call.function.name}` }
    }
    let args: Record<string, unknown>
    try {
      const raw = call.function.arguments
      const parsed = raw ? JSON.parse(raw) : {}
      args = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {}
    } catch {
      return { ok: false, error: 'Argumentos JSON inválidos' }
    }
    try {
      return await tool.handler(ctx, args)
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  /**
   * Genera el seed de `tools_registry` desde el código. La salida se vuelca a
   * un archivo versionado (p.ej. supabase/seed/tools_registry.json) para que la
   * BD deje de ser la única fuente de verdad.
   */
  seedRows(): ToolRegistryRow[] {
    return [...this.byName.values()].map((t) => ({
      name: t.name,
      description: t.description,
      category: t.category,
      args_schema: t.parameters,
      requires_approval: t.requiresApproval,
      is_active: t.isActive,
    }))
  }
}
