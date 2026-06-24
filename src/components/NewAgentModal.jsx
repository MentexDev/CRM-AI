import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Bot,
  Calculator,
  ChevronLeft,
  Loader2,
  MessageCircle,
  Package,
  Plus,
  Sparkles,
  TrendingUp,
} from 'lucide-react'
import toast from 'react-hot-toast'
import Modal from './Modal'
import Select from './Select'
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
  MessageCircle,
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

const DEFAULT_FORM = (overrides = {}) => ({
  slug: '',
  name: '',
  role: 'specialist',
  specialty: '',
  brand_id: '',
  parent_agent_id: '',
  system_prompt: '',
  model: 'llama-3.3-70b-versatile',
  provider: 'groq',
  temperature: 0.4,
  max_tokens: 1500,
  allowed_tools: [],
  ...overrides,
})

/**
 * Modal para crear o editar un agente.
 * - sin `agentId` → modo crear (paso 1: plantilla, paso 2: detalles)
 * - con `agentId` → modo editar (carga el agente y va directo a detalles)
 */
export default function NewAgentModal({ open, onClose, agentId = null }) {
  const isEdit = Boolean(agentId)
  const [step, setStep] = useState('template')
  const [tplId, setTplId] = useState('')
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [loadingEdit, setLoadingEdit] = useState(false)

  useEffect(() => {
    if (!open) return

    if (!isEdit) {
      setStep('template')
      setTplId('')
      setForm(null)
      return
    }

    // Edit: cargar datos del agente y saltar a detalles.
    let active = true
    setLoadingEdit(true)
    setStep('details')
    setTplId('blank')
    ;(async () => {
      const { data, error } = await supabase
        .from('agents')
        .select('*')
        .eq('id', agentId)
        .maybeSingle()
      if (!active) return
      if (error || !data) {
        toast.error('No se pudo cargar el agente')
        onClose()
        return
      }
      setForm(
        DEFAULT_FORM({
          slug: data.slug,
          name: data.name,
          role: data.role,
          specialty: data.specialty || '',
          brand_id: data.brand_id || '',
          parent_agent_id: data.parent_agent_id || '',
          system_prompt: data.system_prompt,
          model: data.model,
          provider: data.provider || 'groq',
          temperature: data.config?.temperature ?? 0.4,
          max_tokens: data.config?.max_tokens ?? 1500,
          allowed_tools: data.allowed_tools || [],
        }),
      )
      setLoadingEdit(false)
    })()

    return () => {
      active = false
    }
  }, [open, isEdit, agentId, onClose])

  const pickTemplate = (id) => {
    const tpl = AGENT_TEMPLATES[id]
    setTplId(id)
    setForm(
      DEFAULT_FORM({
        slug: tpl.suggestedSlug,
        name: tpl.suggestedName,
        role: tpl.role,
        specialty: tpl.specialty,
        system_prompt: tpl.systemPrompt,
        model: tpl.model,
        temperature: tpl.temperature,
        max_tokens: tpl.maxTokens,
        allowed_tools: [...tpl.allowedTools],
      }),
    )
    setStep('details')
  }

  const title = isEdit ? 'Editar agente' : 'Nuevo agente'

  return (
    <Modal open={open} onClose={onClose} title={title} maxWidth="max-w-3xl">
      {loadingEdit ? (
        <div className="grid place-items-center py-10 text-nina-mute">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : step === 'template' ? (
        <TemplateStep onPick={pickTemplate} onCancel={onClose} />
      ) : (
        <DetailsStep
          form={form}
          setForm={setForm}
          tplId={tplId}
          isEdit={isEdit}
          agentId={agentId}
          onBack={isEdit ? null : () => setStep('template')}
          onClose={onClose}
          busy={busy}
          setBusy={setBusy}
        />
      )}
    </Modal>
  )
}

// =====================================================================
// Step 1 · elegir plantilla (solo modo crear)
// =====================================================================
function TemplateStep({ onPick, onCancel }) {
  // Todas las plantillas SIEMPRE disponibles: se pueden tener varios agentes del mismo tipo
  // (p.ej. dos vendedores WhatsApp). El slug se autoincrementa al crear si ya existe (→ contador-2).
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
function DetailsStep({ form, setForm, tplId, isEdit, agentId, onBack, onClose, busy, setBusy }) {
  const { agents } = useAgents()
  const { brands } = useBrands()
  const { tools } = useTools()

  const tpl = AGENT_TEMPLATES[tplId]
  const Icon = ICON_MAP[tpl?.icon] ?? Bot

  // Auto-actualizar slug mientras nombre cambia (sólo si user no editó manualmente).
  // En edit mode dejamos autoSlug=false desde el principio para no pisar el slug existente.
  const [autoSlug, setAutoSlug] = useState(!isEdit)
  useEffect(() => {
    if (autoSlug) setForm((f) => ({ ...f, slug: slugify(f.name) }))
  }, [form?.name, autoSlug, setForm])

  const possibleParents = useMemo(() => {
    if (form?.role === 'ceo_global') return []
    if (form?.role === 'brand_manager') return agents.filter((a) => a.role === 'ceo_global')
    // specialist puede tener brand_manager o ceo. Excluímos al propio agente
    // en edit mode para que no pueda ser su propio padre.
    return agents
      .filter((a) => a.role === 'brand_manager' || a.role === 'ceo_global')
      .filter((a) => !isEdit || a.id !== agentId)
  }, [agents, form?.role, isEdit, agentId])

  // Auto-seleccionar el padre más razonable cuando aún no se haya elegido uno.
  useEffect(() => {
    if (!form) return
    if (form.role === 'ceo_global') {
      if (form.parent_agent_id) setForm((f) => ({ ...f, parent_agent_id: '' }))
      return
    }
    if (form.parent_agent_id) return

    let candidate = null
    if (form.role === 'brand_manager') {
      candidate = possibleParents[0]
    } else {
      if (form.brand_id) {
        candidate = possibleParents.find(
          (p) => p.role === 'brand_manager' && p.brand_id === form.brand_id,
        )
      }
      candidate =
        candidate
        ?? possibleParents.find((p) => p.role === 'brand_manager')
        ?? possibleParents.find((p) => p.role === 'ceo_global')
    }
    if (candidate) setForm((f) => ({ ...f, parent_agent_id: candidate.id }))
  }, [form?.role, form?.brand_id, possibleParents, setForm, form])

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
      const payload = {
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
        config: { temperature: form.temperature, max_tokens: form.max_tokens },
      }

      if (isEdit) {
        const { error } = await supabase.from('agents').update(payload).eq('id', agentId)
        if (error) {
          if (error.code === '23505')
            throw new Error(`Ya existe otro agente con el slug "${form.slug}"`)
          throw error
        }
        toast.success(`${form.name} actualizado`)
      } else {
        // Slug único: si ya existe, autoincrementa (-2, -3…) para permitir varios agentes del
        // mismo tipo. El loop reintenta ante colisión real en BD (23505), también cubre carreras.
        const base = payload.slug
        let candidate = base
        let n = 1
        let inserted = false
        for (let tries = 0; tries < 8 && !inserted; tries++) {
          const { error } = await supabase.from('agents').insert({ ...payload, slug: candidate, status: 'idle' })
          if (!error) { inserted = true; break }
          if (error.code !== '23505') throw error
          n += 1
          candidate = `${base}-${n}` // base-2, base-3, …
        }
        if (!inserted) throw new Error('No pude generar un slug único; cambia el nombre o el slug.')
        toast.success(
          candidate === base
            ? `${form.name} listo. Aparecerá en la lista.`
            : `${form.name} listo como "${candidate}". Aparecerá en la lista.`,
        )
      }
      onClose()
    } catch (err) {
      toast.error(err.message || 'No se pudo guardar el agente')
    } finally {
      setBusy(false)
    }
  }

  if (!form) return null

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="flex items-center gap-3 pb-3 border-b border-nina-line">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="btn-ghost !p-2"
            aria-label="Volver a plantillas"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        )}
        <div className="w-10 h-10 rounded-full grid place-items-center bg-silver-gradient text-nina-black shadow-chrome">
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-[0.2em] text-nina-mute">
            {isEdit ? 'Editando' : 'Plantilla base'}
          </div>
          <div className="text-sm font-medium text-nina-chrome">
            {isEdit ? form.name : tpl?.name ?? 'En blanco'}
          </div>
        </div>
      </div>

      <section className="space-y-3">
        <h4 className="text-xs uppercase tracking-[0.2em] text-nina-mute">Identidad</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Nombre visible *</label>
            <input
              className="input"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Ej: Analista de Tendencias NINA"
            />
          </div>
          <div>
            <label className="label">Slug único *</label>
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
            <Select
              className="w-full"
              value={form.role}
              onChange={(v) =>
                setForm((f) => ({ ...f, role: v, parent_agent_id: '' }))
              }
              options={[
                { value: 'specialist', label: 'Especialista' },
                { value: 'brand_manager', label: 'Brand Manager' },
                { value: 'ceo_global', label: 'CEO Global' },
              ]}
            />
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

      <section className="space-y-3">
        <h4 className="text-xs uppercase tracking-[0.2em] text-nina-mute">Pertenencia</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Marca asignada</label>
            <Select
              className="w-full"
              value={form.brand_id}
              onChange={(v) => setForm((f) => ({ ...f, brand_id: v }))}
              options={[
                { value: '', label: '— Global / sin marca —' },
                ...brands.map((b) => ({ value: b.id, label: b.name })),
              ]}
            />
          </div>
          <div>
            <label className="label">
              Reporta a (padre){form.role !== 'ceo_global' && ' *'}
            </label>
            <Select
              className="w-full"
              value={form.parent_agent_id}
              onChange={(v) => setForm((f) => ({ ...f, parent_agent_id: v }))}
              disabled={form.role === 'ceo_global'}
              options={[
                {
                  value: '',
                  label:
                    form.role === 'ceo_global'
                      ? 'Sin padre (CEO Global)'
                      : '— Selecciona un padre —',
                },
                ...possibleParents.map((p) => ({ value: p.id, label: p.name })),
              ]}
            />
          </div>
        </div>
      </section>

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

      <section className="space-y-3">
        <h4 className="text-xs uppercase tracking-[0.2em] text-nina-mute">Modelo y configuración</h4>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="label">Modelo</label>
            <Select
              className="w-full"
              value={form.model}
              onChange={(v) => setForm((f) => ({ ...f, model: v }))}
              options={[
                { value: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B Versatile' },
                { value: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B Instant' },
                { value: 'qwen-2.5-72b', label: 'Qwen 2.5 72B' },
              ]}
            />
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

      <section className="space-y-3">
        <h4 className="text-xs uppercase tracking-[0.2em] text-nina-mute">Tools permitidas *</h4>
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
      </section>

      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-4 border-t border-nina-line">
        <button type="button" onClick={onClose} className="btn-ghost" disabled={busy}>
          Cancelar
        </button>
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {isEdit ? 'Guardando…' : 'Creando…'}
            </>
          ) : isEdit ? (
            'Guardar cambios'
          ) : (
            'Crear agente'
          )}
        </button>
      </div>
    </form>
  )
}
