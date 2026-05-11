import { useEffect, useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import toast from 'react-hot-toast'
import Modal from './Modal'
import { buildBrandManagerPrompt } from '../lib/agentTemplates'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

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
  description: '',
  brand_voice: '',
  market: '',
  status: 'active',
  ...overrides,
})

/**
 * Modal para crear o editar una marca. En modo crear, ofrece la opción
 * de crear automáticamente el Brand Manager de esa marca (subordinado
 * del CEO Global, con prompt rellenado con la voz de la marca).
 */
export default function NewBrandModal({ open, onClose, brandId = null }) {
  const isEdit = Boolean(brandId)
  const { user } = useAuth()
  const [form, setForm] = useState(DEFAULT_FORM())
  const [autoSlug, setAutoSlug] = useState(!isEdit)
  const [createBM, setCreateBM] = useState(true)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(isEdit)

  useEffect(() => {
    if (!open) return
    if (!isEdit) {
      setForm(DEFAULT_FORM())
      setAutoSlug(true)
      setCreateBM(true)
      setLoading(false)
      return
    }
    let active = true
    setLoading(true)
    ;(async () => {
      const { data, error } = await supabase
        .from('brands')
        .select('*')
        .eq('id', brandId)
        .maybeSingle()
      if (!active) return
      if (error || !data) {
        toast.error('No se pudo cargar la marca')
        onClose()
        return
      }
      setForm(
        DEFAULT_FORM({
          slug: data.slug,
          name: data.name,
          description: data.description || '',
          brand_voice: data.brand_voice || '',
          market: data.market || '',
          status: data.status,
        }),
      )
      setAutoSlug(false)
      setLoading(false)
    })()
    return () => {
      active = false
    }
  }, [open, isEdit, brandId, onClose])

  useEffect(() => {
    if (autoSlug) setForm((f) => ({ ...f, slug: slugify(f.name) }))
  }, [form.name, autoSlug])

  const submit = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) return toast.error('Pon un nombre')
    if (!form.slug.trim()) return toast.error('Falta el slug')

    setBusy(true)
    try {
      const payload = {
        slug: form.slug.trim(),
        name: form.name.trim(),
        description: form.description.trim() || null,
        brand_voice: form.brand_voice.trim() || null,
        market: form.market.trim() || null,
        status: form.status,
      }

      if (isEdit) {
        const { error } = await supabase.from('brands').update(payload).eq('id', brandId)
        if (error) {
          if (error.code === '23505')
            throw new Error(`Ya existe otra marca con el slug "${form.slug}"`)
          throw error
        }
        toast.success(`${form.name} actualizada`)
        onClose()
        return
      }

      // Crear marca
      const { data: brand, error } = await supabase
        .from('brands')
        .insert({ ...payload, created_by: user?.id })
        .select('*')
        .single()
      if (error) {
        if (error.code === '23505')
          throw new Error(`Ya existe una marca con el slug "${form.slug}"`)
        throw error
      }

      // Auto-membresía: el creador (junta) queda como admin de la marca
      await supabase
        .from('brand_memberships')
        .insert({ brand_id: brand.id, user_id: user.id, role: 'admin' })
        .then(({ error: memErr }) => {
          // Si la fila ya existía (porque la junta tiene acceso global), no es problema
          if (memErr && memErr.code !== '23505') {
            console.warn('[CRM-AI] no se pudo crear membership:', memErr)
          }
        })

      // Crear Brand Manager si se pidió
      if (createBM) {
        const { data: ceo } = await supabase
          .from('agents')
          .select('id')
          .eq('role', 'ceo_global')
          .maybeSingle()
        if (!ceo) {
          toast.error(`Marca creada, pero no hay CEO Global para asignar como padre del Brand Manager.`)
        } else {
          const bmPrompt = buildBrandManagerPrompt(brand)
          const bmName = `Brand Manager ${brand.name}`
          const bmSlug = `bm-${brand.slug}`
          const { error: bmErr } = await supabase.from('agents').insert({
            slug: bmSlug,
            name: bmName,
            role: 'brand_manager',
            specialty: null,
            brand_id: brand.id,
            parent_agent_id: ceo.id,
            system_prompt: bmPrompt,
            model: 'llama-3.3-70b-versatile',
            provider: 'groq',
            allowed_tools: [
              'delegate_task',
              'request_approval',
              'save_memory',
              'search_memory',
              'read_kpis',
              'finish_task',
              'escalate_to_ceo',
              'web_search',
              'shopify_search_products',
              'shopify_recent_orders',
              'shopify_search_customers',
              'shopify_shop_summary',
            ],
            status: 'idle',
            config: { temperature: 0.4, max_tokens: 1500 },
          })
          if (bmErr) {
            console.warn('[CRM-AI] no se pudo crear BM:', bmErr)
            toast.error(`Marca creada, pero el Brand Manager falló: ${bmErr.message}`)
          } else {
            toast.success(`${brand.name} creada con ${bmName}`)
          }
        }
      } else {
        toast.success(`${brand.name} creada`)
      }

      onClose()
    } catch (err) {
      toast.error(err.message || 'No se pudo guardar la marca')
    } finally {
      setBusy(false)
    }
  }

  const title = isEdit ? 'Editar marca' : 'Nueva marca'

  return (
    <Modal open={open} onClose={onClose} title={title} maxWidth="max-w-2xl">
      {loading ? (
        <div className="grid place-items-center py-10 text-nina-mute">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-5">
          <section className="space-y-3">
            <h4 className="text-xs uppercase tracking-[0.2em] text-nina-mute">Identidad</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">Nombre *</label>
                <input
                  className="input"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Ej: NINA"
                  autoFocus={!isEdit}
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
                  placeholder="nina"
                />
              </div>
            </div>
            {isEdit && (
              <div>
                <label className="label">Estado</label>
                <select
                  className="input"
                  value={form.status}
                  onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                >
                  <option value="active">Activa</option>
                  <option value="paused">En pausa</option>
                  <option value="archived">Archivada</option>
                </select>
              </div>
            )}
          </section>

          <section className="space-y-3">
            <h4 className="text-xs uppercase tracking-[0.2em] text-nina-mute">Descripción / Manifiesto</h4>
            <textarea
              className="input min-h-[140px] resize-y leading-relaxed"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Quiénes son, qué venden, qué los diferencia. Esto se le pasa al Brand Manager como parte de su contexto permanente."
            />
          </section>

          <section className="space-y-3">
            <h4 className="text-xs uppercase tracking-[0.2em] text-nina-mute">Voz de marca</h4>
            <textarea
              className="input min-h-[100px] resize-y leading-relaxed"
              value={form.brand_voice}
              onChange={(e) => setForm((f) => ({ ...f, brand_voice: e.target.value }))}
              placeholder="Adjetivos y reglas de tono. Ej: 'Auténtica. Empoderadora. Sin filtros. Habla de libertad. Nunca cosifica el cuerpo.'"
            />
          </section>

          <section className="space-y-3">
            <h4 className="text-xs uppercase tracking-[0.2em] text-nina-mute">Mercado</h4>
            <textarea
              className="input min-h-[80px] resize-y leading-relaxed"
              value={form.market}
              onChange={(e) => setForm((f) => ({ ...f, market: e.target.value }))}
              placeholder="Audiencia objetivo, geografía, segmento. Ej: 'Mujeres 20-35 años en Colombia, urbanas, ingresos medio-altos.'"
            />
          </section>

          {!isEdit && (
            <section className="rounded-xl border border-nina-line bg-nina-ink p-3">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={createBM}
                  onChange={(e) => setCreateBM(e.target.checked)}
                  className="mt-0.5 accent-nina-silver"
                />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-nina-chrome flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-nina-silver" />
                    Crear Brand Manager automáticamente
                  </div>
                  <div className="text-[12px] text-nina-mute leading-snug mt-1">
                    Se generará un agente <code className="text-nina-chrome font-mono">bm-{form.slug || 'slug'}</code> con
                    rol Brand Manager, padre = CEO Global, y system prompt rellenado con la descripción y voz de esta marca.
                    Vendrá listo con las tools necesarias (delegate, memoria, KPIs, web_search, Shopify).
                  </div>
                </div>
              </label>
            </section>
          )}

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
                'Crear marca'
              )}
            </button>
          </div>
        </form>
      )}
    </Modal>
  )
}
