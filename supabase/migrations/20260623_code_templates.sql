-- Sección "Plantillas Code": galería de plantillas de trabajo (estilo Notion Marketplace) que crea el
-- agente Code. Guarda el ARTEFACTO COMPLETO (data jsonb) para poder reabrirlo interactivo, + portada.
create table if not exists public.code_templates (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  kind text not null default 'document',           -- document | sheet | board | slides
  data jsonb not null default '{}'::jsonb,           -- payload del artefacto (markdown / nodes / columns+rows / slides)
  cover_url text,                                     -- portada (estilo Notion)
  description text,
  category text,                                     -- Productividad | Finanzas | Marketing | Ventas | ...
  brand_id uuid references public.brands(id) on delete cascade,  -- null = global (todas las marcas)
  agent_id uuid references public.agents(id) on delete set null,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists code_templates_brand_idx on public.code_templates(brand_id, created_at desc);

alter table public.code_templates enable row level security;
drop policy if exists code_templates_select on public.code_templates;
create policy code_templates_select on public.code_templates for select
  using (brand_id is null or public.has_brand_access(brand_id));
drop policy if exists code_templates_insert on public.code_templates;
create policy code_templates_insert on public.code_templates for insert
  with check (public.is_junta() or created_by = auth.uid());
drop policy if exists code_templates_update on public.code_templates;
create policy code_templates_update on public.code_templates for update
  using (public.is_junta() or created_by = auth.uid());
drop policy if exists code_templates_delete on public.code_templates;
create policy code_templates_delete on public.code_templates for delete
  using (public.is_junta() or created_by = auth.uid());

alter publication supabase_realtime add table public.code_templates;
