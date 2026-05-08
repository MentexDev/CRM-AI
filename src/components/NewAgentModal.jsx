import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Bot,
  Calculator,
  ChevronLeft,
  Loader2,
  Package,
  Plus,
  Sparkles,
  TrendingUp,
} from 'lucide-react'
import toast from 'react-hot-toast'
import Modal from './Modal'
import { AGENT_TEMPLATES, TEMPLATE_LIST } from '../lib/agentTemplates'
import { useAgents } from '../hooks/useAgents'
import { useBrands } from '../hooks/useBrands'
import { useTools } from '../hooks/useTools'
import { supabase } from '../lib/supabase'

const ICON_MAP = {
  TrendingUp,
  Sparkles,
  Calculator,
  Package,
  Plus,
}

const slugify = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

export default function NewAgentModal({ open, onClose }) {
  const [step, setStep] = useState('template') // 'template' | 'details'
  const [tplId, setTplId] = useState('')
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)

  // Reset al abrir
  useEffect(() => {
    if (!open) return
    setStep('template')
    setTplId('')
    setForm(null)
  }, [open])

  const pickTemplate = (id) => {
    const tpl = AGENT_TEMPLATES[id]
    setTplId(id)
    setForm({
      slug: tpl.suggestedSlug,
      name: tpl.suggestedName,
      role: tpl.role,
      specialty: tpl.specialty,
      brand_id: '',
      parent_agent_id: '',
      system_prompt: tpl.systemPrompt,
      model: tpl.model,
      provider: 'groq',
      temperature: tpl.temperature,
      max_tokens: tpl.maxTokens,
      allowed_tools: [...tpl.allowedTools],
    })
    setStep('details')
  }

  return (
    <Modal open={open} onClose={onClose} title="Nuevo agente" maxWidth="max-w-3xl">
      {step === 'template' ? (
        <TemplateStep onPick={pickTemplate} onCancel={onClose} />
      ) : (
        <DetailsStep
          form={form}
          setForm={setForm}
          tplId={tplId}
          onBack={() => setStep('template')}
          onClose={onClose}
          busy={busy}
          setBusy={setBusy}
        />
      )}
    </Modal>
  )
}

// =====================================================================
// Step 1 · elegir plantilla
// =====================================================================
function TemplateStep({ onPick, onCancel }) {
  return (
    <div className="space-y-5">
      <p className="text-sm text-nina-mute">
        Elige un perfil base para arrancar. Vas a poder editar todo (nombre, prompt, tools, modelo)
        antes de crear el agente.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {TEMPLATE_LIST.map((tpl) => {
          const Icon = ICON_MAP[tpl.icon] ?? Bot
          return (
            <motion.button
              key={tpl.id}
              type="button"
              onClick={() => onPick(tpl.id)}
              whileHover={{ y: -2 }}
              className="text-left rounded-xl border border-nina-line bg-nina-ink p-4 hover:border-nina-silver/30 hover:shadow-glow transition group"
            >
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full grid place-items-center bg-silver-gradient text-nina-black shadow-chrome flex-shrink-0">
                  <Icon className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-nina-chrome">{tpl.name}</div>
                  <div className="text-[12px] text-nina-mute mt-1 leading-snug">
                    {tpl.description}
                  </div>
                </div>
              </div>
            </motion.button>
          )
        })}
      </div>
      <div className="flex justify-end pt-2 border-t border-nina-line">
        <button onClick={onCancel} className="btn-ghost text-sm">
          Cancelar
        </button>
      </div>
    </div>
  )
}

// =====================================================================
// Step 2 · detalles del agente (editable)
// =====================================================================
function DetailsStep({ form, setForm, tplId, onBack, onClose, busy, setBusy }) {
  const { agents } = useAgents()
  const { brands } = useBrands()
  const { tools } = useTools()

  const tpl = AGENT_TEMPLATES[tplId]
  const Icon = ICON_MAP[tpl?.icon] ?? Bot

  // Auto-actualizar slug mientras nombre cambia y el slug actual sea derivado del nombre previo.
  // Heurística simple: si el slug coincide con slugify(prevName) lo regeneramos. Si el user lo
  // editó manual, lo dejamos quieto.
  const [autoSlug, setAutoSlug] = useState(true)
  useEffect(() => {
    if (autoSlug) setForm((f) => ({ ...f, slug: slugify(f.name) }))
  }, [form?.name, autoSlug, setForm])

  const possibleParents = useMemo(() => {
    // ceo_global no tiene padre.
    // brand_manager solo puede tener un ceo como padre.
    // specialist puede tener brand_manager o ceo como padre.
    if (form?.role === 'ceo_global') return []
    if (form?.role === 'brand_manager') return agents.filter((a) => a.role === 'ceo_global')
    return agents.filter((a) => a.role === 'brand_manager' || a.role === 'ceo_global')
  }, [agents, form?.role])

  const toggleTool = (name) => {
    setForm((f) => {
      const has = f.allowed_tools.includes(name)
      return {
        ...f,
        allowed_tools: has ? f.allowed_tools.filter((t) => t !== name) : [...f.allowed_tools, name],
      }
    })
  }

  const submit = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) return toast.error('Pon un nombre')
    if (!form.slug.trim()) return toast.error('Falta el slug')
    if (!form.system_prompt.trim()) return toast.error('El system prompt no puede estar vacío')
    if (form.allowed_tools.length === 0)
      return toast.error('Selecciona al menos una tool permitida')
    if (form.role !== 'ceo_global' && !form.parent_agent_id)
      return toast.error('Asigna un agente padre (a quién reporta)')

    setBusy(true)
    try {
      const { error } = await supabase.from('agents').insert({
        slug: form.slug.trim(),
        name: form.name.trim(),
        role: form.role,
        specialty: form.specialty?.trim() || null,
        brand_id: form.brand_id || null,
        parent_agent_id: form.parent_agent_id || null,
        system_prompt: form.system_prompt,
        model: form.model,
        provider: form.provider,
        allowed_tools: form.allowed_tools,
        status: 'idle',
        config: { temperature: form.temperature, max_tokens: form.max_tokens },
      })
      if (error) {
        if (error.code === '23505') {
          throw new Error(`Ya existe un agente con el slug "${form.slug}"`)
        }
        throw error
      }
      toast.success(`${form.name} listo. Aparecerá en la lista de agentes.`)
      onClose()
    } catch (err) {
      toast.error(err.message || 'No se pudo crear el agente')
    } finally {
      setBusy(false)
    }
  }

  if (!form) return null

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="flex items-center gap-3 pb-3 border-b border-nina-line">
        <button
          type="button"
          onClick={onBack}
          className="btn-ghost !p-2"
          aria-label="Volver a plantillas"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="w-10 h-10 rounded-full grid place-items-center bg-silver-gradient text-nina-black shadow-chrome">
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-[0.2em] text-nina-mute">
            Plantilla base
          </div>
          <div className="text-sm font-medium text-nina-chrome">{tpl?.name ?? 'En blanco'}</div>
        </div>
      </div>

      {/* Identidad */}
      <section className="space-y-3">
        <h4 className="text-xs uppercase tracking-[0.2em] text-nina-mute">Identidad</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Nombre visible</label>
            <input
              className="input"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Ej: Analista de Tendencias NINA"
            />
          </div>
          <div>
            <label className="label">Slug único</label>
            <input
              className="input font-mono text-[13px]"
              value={form.slug}
              onChange={(e) => {
                setAutoSlug(false)
                setForm((f) => ({ ...f, slug: slugify(e.target.value) }))
              }}
              placeholder="analista-tendencias-nina"
            />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Rol jerárquico</label>
            <select
              className="input"
              value={form.role}
              onChange={(e) =>
                setForm((f) => ({ ...f, role: e.target.value, parent_agent_id: '' }))
              }
            >
              <option value="specialist">Especialista</option>
              <option value="brand_manager">Brand Manager</option>
              <option value="ceo_global">CEO Global</option>
            </select>
          </div>
          <div>
            <label className="label">Especialidad / etiqueta</label>
            <input
              className="input"
              value={form.specialty || ''}
              onChange={(e) => setForm((f) => ({ ...f, specialty: e.target.value }))}
              placeholder="ej. analista_tendencias"
            />
          </div>
        </div>
      </section>

      {/* Pertenencia */}
      <section className="space-y-3">
        <h4 className="text-xs uppercase tracking-[0.2em] text-nina-mute">Pertenencia</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Marca asignada</label>
            <select
              className="input"
              value={form.brand_id}
              onChange={(e) => setForm((f) => ({ ...f, brand_id: e.target.value }))}
            >
              <option value="">— Global / sin marca —</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Reporta a (padre)</label>
            <select
              className="input"
              value={form.parent_agent_id}
              onChange={(e) => setForm((f) => ({ ...f, parent_agent_id: e.target.value }))}
              disabled={form.role === 'ceo_global'}
            >
              <option value="">
                {form.role === 'ceo_global' ? 'Sin padre (CEO Global)' : '— Selecciona un padre —'}
              </option>
              {possibleParents.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {/* System prompt */}
      <section className="space-y-3">
        <h4 className="text-xs uppercase tracking-[0.2em] text-nina-mute">Perfil del agente</h4>
        <textarea
          className="input min-h-[260px] sm:min-h-[320px] resize-y font-mono text-[12.5px] leading-relaxed"
          value={form.system_prompt}
          onChange={(e) => setForm((f) => ({ ...f, system_prompt: e.target.value }))}
          placeholder="Identidad, misión, cómo trabaja, reglas duras, estilo..."
        />
        <p className="text-[11px] text-nina-mute">
          Este texto es lo que el agente "recuerda" en cada turno. Sé específico con sus reglas
          duras y los límites donde debe pedir aprobación.
        </p>
      </section>

      {/* Modelo y configuración */}
      <section className="space-y-3">
        <h4 className="text-xs uppercase tracking-[0.2em] text-nina-mute">Modelo y configuración</h4>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="label">Modelo</label>
            <select
              className="input"
              value={form.model}
              onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
            >
              <optgroup label="Groq (rápido y barato)">
                <option value="llama-3.3-70b-versatile">Llama 3.3 70B Versatile</option>
                <option value="llama-3.1-8b-instant">Llama 3.1 8B Instant</option>
                <option value="qwen-2.5-72b">Qwen 2.5 72B</option>
              </optgroup>
            </select>
          </div>
          <div>
            <label className="label">
              Temperatura ·{' '}
              <span className="text-nina-chrome font-mono">{form.temperature.toFixed(2)}</span>
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={form.temperature}
              onChange={(e) =>
                setForm((f) => ({ ...f, temperature: Number(e.target.value) }))
              }
              className="w-full accent-nina-silver"
            />
            <div className="flex justify-between text-[10px] text-nina-mute mt-1">
              <span>Determinista</span>
              <span>Creativo</span>
            </div>
          </div>
          <div>
            <label className="label">Max tokens</label>
            <input
              type="number"
              className="input"
              min={200}
              max={8000}
              step={100}
              value={form.max_tokens}
              onChange={(e) =>
                setForm((f) => ({ ...f, max_tokens: Number(e.target.value) || 1500 }))
              }
            />
          </div>
        </div>
      </section>

      {/* Tools */}
      <section className="space-y-3">
        <h4 className="text-xs uppercase tracking-[0.2em] text-nina-mute">Tools permitidas</h4>
        {tools.length === 0 ? (
          <div className="text-[11px] text-nina-mute italic">Cargando tools…</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {tools.map((t) => {
              const checked = form.allowed_tools.includes(t.name)
              return (
                <label
                  key={t.name}
                  className={`flex items-start gap-2 rounded-lg border p-2.5 cursor-pointer transition ${
                    checked
                      ? 'border-nina-silver/40 bg-nina-line/40'
                      : 'border-nina-line bg-nina-ink hover:border-nina-line'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleTool(t.name)}
                    className="mt-0.5 accent-nina-silver"
                  />
                  <div className="min-w-0">
                    <div className="text-[12px] font-mono text-nina-chrome flex items-center gap-1.5">
                      {t.name}
                      {t.requires_approval && (
                        <span className="text-[9px] uppercase tracking-[0.15em] text-amber-300/80">
                          aprobación
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-nina-mute leading-snug mt-0.5">
                      {t.description}
                    </div>
                  </div>
                </label>
              )
            })}
          </div>
        )}
        <p className="text-[11px] text-nina-mute">
          Sólo las tools marcadas estarán disponibles para este agente. Tools que aún no existan
          en el runtime aparecerán como llamadas fallidas hasta que se implementen.
        </p>
      </section>

      {/* Footer */}
      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-4 border-t border-nina-line">
        <button type="button" onClick={onClose} className="btn-ghost" disabled={busy}>
          Cancelar
        </button>
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Creando…
            </>
          ) : (
            'Crear agente'
          )}
        </button>
      </div>
    </form>
  )
}
