// Capa de proveedores LLM. Interfaz genérica + Groq + OpenAI + Anthropic (Claude).
import OpenAI from 'npm:openai@^4'
import Anthropic from 'npm:@anthropic-ai/sdk'

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool'

export interface ChatMessage {
  role: ChatRole
  content: string | null
  tool_call_id?: string
  tool_calls?: ToolCallRequest[]
  name?: string
}

export interface ToolCallRequest {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface ChatCompleteParams {
  model: string
  messages: ChatMessage[]
  tools?: ToolDefinition[]
  temperature?: number
  max_tokens?: number
}

export interface ChatCompleteResult {
  content: string | null
  tool_calls: ToolCallRequest[]
  finish_reason: string
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
}

export interface StreamCallbacks {
  onText?: (delta: string) => void
}

export interface LLMProvider {
  complete(params: ChatCompleteParams): Promise<ChatCompleteResult>
  // Opcional: completa en streaming, llamando onText por cada delta de texto.
  // Devuelve el MISMO resultado final que complete() (incl. tool_calls).
  completeStream?(params: ChatCompleteParams, cb: StreamCallbacks): Promise<ChatCompleteResult>
}

class GroqProvider implements LLMProvider {
  private client: OpenAI

  constructor(apiKey: string) {
    this.client = new OpenAI({
      apiKey,
      baseURL: 'https://api.groq.com/openai/v1',
    })
  }

  async complete(params: ChatCompleteParams): Promise<ChatCompleteResult> {
    const useTools = params.tools && params.tools.length > 0
    const resp = await this.client.chat.completions.create({
      model: params.model,
      messages: params.messages as never,
      tools: useTools ? (params.tools as never) : undefined,
      tool_choice: useTools ? 'auto' : undefined,
      temperature: params.temperature,
      max_tokens: params.max_tokens,
    })
    const choice = resp.choices[0]
    return {
      content: choice.message.content ?? null,
      tool_calls: (choice.message.tool_calls ?? []) as ToolCallRequest[],
      finish_reason: choice.finish_reason ?? 'stop',
      usage: resp.usage as ChatCompleteResult['usage'],
    }
  }
}

class OpenAIProvider implements LLMProvider {
  private client: OpenAI

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey })
  }

  async complete(params: ChatCompleteParams): Promise<ChatCompleteResult> {
    const useTools = params.tools && params.tools.length > 0
    const resp = await this.client.chat.completions.create({
      model: params.model,
      messages: params.messages as never,
      tools: useTools ? (params.tools as never) : undefined,
      tool_choice: useTools ? 'auto' : undefined,
      temperature: params.temperature,
      max_tokens: params.max_tokens,
    })
    const choice = resp.choices[0]
    return {
      content: choice.message.content ?? null,
      tool_calls: (choice.message.tool_calls ?? []) as ToolCallRequest[],
      finish_reason: choice.finish_reason ?? 'stop',
      usage: resp.usage as ChatCompleteResult['usage'],
    }
  }
}

// =====================================================================
// Anthropic (Claude) — proveedor con traducción de formato OpenAI ↔ Anthropic.
//
// El runtime usa formato estilo OpenAI (tool_calls / tool_call_id). Claude usa
// bloques `tool_use` / `tool_result` y `system` aparte. Traducimos en la
// frontera para NO tocar agent_chat.ts / agent_step.ts / tools.ts.
// =====================================================================

// Opus 4.7/4.8 eliminaron temperature/top_p/top_k → enviarlas devuelve 400.
function anthropicRejectsSampling(model: string): boolean {
  return /opus-4-(7|8)/.test(model)
}

function mapAnthropicStop(r: string | null): string {
  switch (r) {
    case 'tool_use': return 'tool_calls'
    case 'max_tokens': return 'length'
    case 'end_turn': return 'stop'
    case 'refusal': return 'refusal'
    default: return r ?? 'stop'
  }
}

interface AnthropicTurn {
  role: 'user' | 'assistant'
  content: Record<string, unknown>[]
}

// Convierte el historial OpenAI-shaped a (system, mensajes Anthropic), fusionando
// turnos consecutivos del mismo rol (Anthropic exige alternancia user/assistant).
function toAnthropic(messages: ChatMessage[]): { system?: string; msgs: AnthropicTurn[] } {
  const sys: string[] = []
  const out: AnthropicTurn[] = []
  const push = (role: 'user' | 'assistant', block: Record<string, unknown>) => {
    const last = out[out.length - 1]
    if (last && last.role === role) last.content.push(block)
    else out.push({ role, content: [block] })
  }
  for (const m of messages) {
    if (m.role === 'system') {
      if (m.content) sys.push(m.content)
    } else if (m.role === 'tool') {
      // resultado de tool → va en un turno de usuario como tool_result
      push('user', { type: 'tool_result', tool_use_id: m.tool_call_id ?? '', content: m.content ?? '' })
    } else if (m.role === 'user') {
      if (m.content) push('user', { type: 'text', text: m.content })
    } else if (m.role === 'assistant') {
      if (m.content) push('assistant', { type: 'text', text: m.content })
      for (const tc of m.tool_calls ?? []) {
        let input: unknown = {}
        try { input = tc.function.arguments ? JSON.parse(tc.function.arguments) : {} } catch { input = {} }
        push('assistant', { type: 'tool_use', id: tc.id, name: tc.function.name, input })
      }
    }
  }
  return { system: sys.length ? sys.join('\n\n') : undefined, msgs: out }
}

class AnthropicProvider implements LLMProvider {
  private client: Anthropic

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey })
  }

  async complete(params: ChatCompleteParams): Promise<ChatCompleteResult> {
    const { system, msgs } = toAnthropic(params.messages)
    const tools = params.tools?.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }))

    const resp = await this.client.messages.create({
      model: params.model,
      max_tokens: params.max_tokens ?? 1500,
      system,
      messages: msgs as never,
      tools: tools && tools.length > 0 ? (tools as never) : undefined,
      // Opus 4.7/4.8 rechazan temperature; el resto de modelos Claude la aceptan.
      ...(params.temperature != null && !anthropicRejectsSampling(params.model)
        ? { temperature: params.temperature }
        : {}),
    })

    let text = ''
    const tool_calls: ToolCallRequest[] = []
    for (const block of resp.content) {
      if (block.type === 'text') text += block.text
      else if (block.type === 'tool_use') {
        tool_calls.push({
          id: block.id,
          type: 'function',
          function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
        })
      }
    }

    return {
      content: text || null,
      tool_calls,
      finish_reason: mapAnthropicStop(resp.stop_reason),
      usage: {
        prompt_tokens: resp.usage.input_tokens,
        completion_tokens: resp.usage.output_tokens,
        total_tokens: resp.usage.input_tokens + resp.usage.output_tokens,
      },
    }
  }

  async completeStream(params: ChatCompleteParams, cb: StreamCallbacks): Promise<ChatCompleteResult> {
    const { system, msgs } = toAnthropic(params.messages)
    const tools = params.tools?.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }))

    const stream = this.client.messages.stream({
      model: params.model,
      max_tokens: params.max_tokens ?? 1500,
      system,
      messages: msgs as never,
      tools: tools && tools.length > 0 ? (tools as never) : undefined,
      ...(params.temperature != null && !anthropicRejectsSampling(params.model)
        ? { temperature: params.temperature }
        : {}),
    })
    stream.on('text', (delta: string) => cb.onText?.(delta))
    const resp = await stream.finalMessage()

    let text = ''
    const tool_calls: ToolCallRequest[] = []
    for (const block of resp.content) {
      if (block.type === 'text') text += block.text
      else if (block.type === 'tool_use') {
        tool_calls.push({
          id: block.id,
          type: 'function',
          function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
        })
      }
    }
    return {
      content: text || null,
      tool_calls,
      finish_reason: mapAnthropicStop(resp.stop_reason),
      usage: {
        prompt_tokens: resp.usage.input_tokens,
        completion_tokens: resp.usage.output_tokens,
        total_tokens: resp.usage.input_tokens + resp.usage.output_tokens,
      },
    }
  }
}

export function makeProvider(name: string): LLMProvider {
  if (name === 'groq') {
    const key = Deno.env.get('GROQ_API_KEY')
    if (!key) throw new Error('GROQ_API_KEY no está definido')
    return new GroqProvider(key)
  }
  if (name === 'openai') {
    const key = Deno.env.get('OPENAI_API_KEY')
    if (!key) throw new Error('OPENAI_API_KEY no está definido')
    return new OpenAIProvider(key)
  }
  if (name === 'anthropic') {
    const key = Deno.env.get('ANTHROPIC_API_KEY')
    if (!key) throw new Error('ANTHROPIC_API_KEY no está definido')
    return new AnthropicProvider(key)
  }
  throw new Error(`Provider no implementado: ${name}`)
}

// =====================================================================
// Embeddings (OpenAI text-embedding-3-small · 1536 dims · $0.02/1M tokens)
// =====================================================================

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const key = Deno.env.get('OPENAI_API_KEY')
  if (!key) throw new Error('OPENAI_API_KEY no está definido para embeddings')
  const client = new OpenAI({ apiKey: key })
  const resp = await client.embeddings.create({
    model: 'text-embedding-3-small',
    input: texts,
    encoding_format: 'float',
  })
  // El API devuelve los embeddings en el orden del input
  return resp.data
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding)
}

export async function embedText(text: string): Promise<number[]> {
  const [vec] = await embedTexts([text])
  return vec
}
