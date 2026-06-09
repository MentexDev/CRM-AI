// Capa de proveedores LLM. Interfaz genérica + Groq + OpenAI (embeddings).
import OpenAI from 'npm:openai@^4'

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

export interface LLMProvider {
  complete(params: ChatCompleteParams): Promise<ChatCompleteResult>
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
