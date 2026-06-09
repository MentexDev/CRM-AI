// Edge Function: auto-distill — Protocolo Aetherna
//
// Se invoca después de cada finish_task exitoso y destila el conocimiento
// generado en esa tarea al brain de la marca.
//
// Flujo:
//   1. Leer el historial de mensajes de la tarea completada
//   2. Pase LLM: extraer 3-7 learnings concretos de la conversación
//   3. Ingestar cada learning como un knowledge_chunk con source_kind='distillation'
//   4. Registrar en brain_evolution_log
//
// Body: { task_id, agent_id, brand_id }
import { adminDb } from '../_shared/db.ts'
import { makeProvider } from '../_shared/llm.ts'
import { embedTexts } from '../_shared/llm.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface Learning {
  content: string
  importance: number  // 0.0-1.0
}

async function extractLearnings(
  taskTitle: string,
  taskResult: string,
  conversationSummary: string,
): Promise<Learning[]> {
  const provider = makeProvider(Deno.env.get('GROQ_API_KEY') ? 'groq' : 'openai')

  const prompt = `Eres un sistema de destilación de conocimiento. Analiza el siguiente resultado de una tarea de un agente de IA y extrae los learnings más valiosos para el futuro.

Tarea: ${taskTitle}
Resultado: ${taskResult}
Contexto de la conversación: ${conversationSummary.slice(0, 3000)}

Extrae entre 3 y 7 learnings concretos, accionables y reutilizables. Cada learning debe:
- Ser una afirmación factual o una lección aprendida, no una descripción del proceso
- Poder ser útil para tareas futuras similares
- Ser específico, no genérico

Responde SOLO con un JSON válido:
{
  "learnings": [
    {"content": "aprendizaje concreto aquí", "importance": 0.0-1.0}
  ]
}

Si la tarea no generó conocimiento nuevo útil, responde {"learnings":[]}.`

  try {
    const result = await provider.complete({
      model: Deno.env.get('GROQ_API_KEY') ? 'llama-3.3-70b-versatile' : 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 600,
    })

    const raw = result.content ?? ''
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return []
    const parsed = JSON.parse(jsonMatch[0]) as { learnings: Learning[] }
    return Array.isArray(parsed.learnings) ? parsed.learnings.slice(0, 7) : []
  } catch {
    return []
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS })
  }

  try {
    const body = await req.json() as {
      task_id: string
      agent_id: string
      brand_id?: string
    }

    if (!body.task_id || !body.agent_id) {
      return new Response(JSON.stringify({ error: 'Faltan task_id o agent_id' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const db = adminDb()

    // 1. Leer la tarea y su resultado
    const { data: task } = await db
      .from('tasks')
      .select('id, title, description, result, brand_id, agent_id')
      .eq('id', body.task_id)
      .eq('status', 'done')
      .maybeSingle()

    if (!task) {
      return new Response(JSON.stringify({ ok: true, skipped: 'tarea no encontrada o no está done' }), {
        status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const brandId = task.brand_id ?? body.brand_id
    if (!brandId) {
      return new Response(JSON.stringify({ ok: true, skipped: 'sin brand_id — no hay dónde guardar el conocimiento' }), {
        status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    // 2. Leer últimos mensajes de la tarea (contexto de la conversación)
    const { data: messages } = await db
      .from('messages')
      .select('role, content')
      .eq('agent_id', body.agent_id)
      .eq('task_id', body.task_id)
      .order('created_at', { ascending: true })
      .limit(30)

    const conversationSummary = (messages ?? [])
      .filter((m) => m.role !== 'tool' && m.content)
      .map((m) => `[${m.role}] ${(m.content ?? '').slice(0, 300)}`)
      .join('\n')

    const taskResult = typeof task.result === 'object'
      ? JSON.stringify(task.result)
      : String(task.result ?? '')

    // 3. Extraer learnings vía LLM
    const learnings = await extractLearnings(task.title, taskResult, conversationSummary)

    if (learnings.length === 0) {
      return new Response(JSON.stringify({ ok: true, chunks_added: 0, learnings: [] }), {
        status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    // 4. Embeber los learnings
    const texts = learnings.map((l) => l.content)
    let embeddings: number[][] = []
    try {
      embeddings = await embedTexts(texts)
    } catch {
      // Sin OpenAI key: guardar sin embedding (brain-doctor los recogerá después)
      embeddings = texts.map(() => [])
    }

    // 5. Ingestar como distillation document + chunks
    // Creamos un documento fuente que agrupa los learnings de esta tarea
    const { data: doc, error: docErr } = await db
      .from('knowledge_documents')
      .insert({
        brand_id: brandId,
        source_kind: 'conversation',
        title: `Destilación: ${task.title}`,
        content: learnings.map((l) => `• ${l.content}`).join('\n'),
        status: 'ingested',
        ingested_by_agent_id: body.agent_id,
        metadata: { task_id: body.task_id, source: 'auto_distill' },
      })
      .select('id')
      .single()

    if (docErr) {
      return new Response(JSON.stringify({ ok: false, error: docErr.message }), {
        status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const chunkRows = learnings.map((l, i) => ({
      document_id: doc.id,
      brand_id: brandId,
      chunk_index: i,
      content: l.content,
      token_count: Math.ceil(l.content.length / 4),
      embedding: embeddings[i]?.length > 0 ? JSON.stringify(embeddings[i]) : null,
      importance: l.importance ?? 0.6,
      source_kind: 'distillation',
    }))

    const { error: chunksErr } = await db.from('knowledge_chunks').insert(chunkRows)
    if (chunksErr) {
      return new Response(JSON.stringify({ ok: false, error: chunksErr.message }), {
        status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    // 6. Registrar en brain_evolution_log
    await db.from('brain_evolution_log').insert({
      brand_id: brandId,
      source_agent_id: body.agent_id,
      source_task_id: body.task_id,
      chunks_added: learnings.length,
      entities_added: 0,
      learnings: learnings.map((l) => l.content),
      trigger_kind: 'task_completion',
    })

    return new Response(JSON.stringify({
      ok: true,
      document_id: doc.id,
      chunks_added: learnings.length,
      learnings: learnings.map((l) => l.content),
    }), {
      status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
