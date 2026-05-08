// Capa de proveedores LLM. Interfaz genérica + implementación de Groq.
// Groq es OpenAI-compatible, así que reusamos el SDK oficial apuntado a su URL.
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

export function makeProvider(name: string): LLMProvider {
  if (name === 'groq') {
    const key = Deno.env.get('GROQ_API_KEY')
    if (!key) throw new Error('GROQ_API_KEY no está definido en el entorno')
    return new GroqProvider(key)
  }
  // Espacios reservados para Anthropic / OpenAI cuando los activemos.
  throw new Error(`Provider no implementado todavía: ${name}`)
}
