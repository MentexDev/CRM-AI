// Skills: playbooks/guías (Markdown) asignadas a un agente — CONOCIMIENTO y método, no acciones.
// loadAgentSkillsPrompt carga las skills asignadas y arma un bloque para inyectar en el system
// prompt del agente. Con topes para no inflar el contexto (por skill y total).
//
// db: cliente supabase (admin). Se tipa de forma estructural para evitar fricción de versiones.

const PER_SKILL_CAP = 8000 // tope de contenido por skill
const TOTAL_CAP = 30000 // tope total del bloque

type Db = { from: (table: string) => any }
type SkillRow = { name?: string; description?: string; content?: string }

export async function loadAgentSkillsPrompt(db: Db, agentId: string): Promise<string> {
  let data: unknown
  try {
    const res = await db
      .from('agent_skills')
      .select('skills(name, description, content)')
      .eq('agent_id', agentId)
    if (res.error) return ''
    data = res.data
  } catch {
    return '' // ante cualquier fallo de la consulta, NO rompemos el turno del agente
  }
  const rows = Array.isArray(data) ? data : []
  const skills: SkillRow[] = rows
    .map((r) => {
      const sk = (r as { skills?: SkillRow | SkillRow[] }).skills
      return Array.isArray(sk) ? sk[0] : sk
    })
    .filter((s): s is SkillRow => !!s)
  if (!skills.length) return ''

  const parts: string[] = []
  let total = 0
  for (const s of skills) {
    const name = (s.name ?? 'Skill').trim()
    const desc = (s.description ?? '').trim()
    let content = (s.content ?? '').trim()
    if (!content && !desc) continue
    if (content.length > PER_SKILL_CAP) content = `${content.slice(0, PER_SKILL_CAP)}\n…(truncado)`
    const block = `### ${name}\n${desc ? `${desc}\n\n` : ''}${content}`
    if (total + block.length > TOTAL_CAP) break
    parts.push(block)
    total += block.length
  }
  if (!parts.length) return ''

  return (
    `## Habilidades (skills) disponibles\n` +
    `Tienes estos playbooks/guías de trabajo. Aplícalos cuando la tarea lo requiera; son ` +
    `conocimiento y método, no herramientas que ejecutar.\n\n` +
    parts.join('\n\n---\n\n')
  )
}
