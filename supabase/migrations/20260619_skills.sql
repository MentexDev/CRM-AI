-- Skills: playbooks/guías en Markdown que ALIMENTAN a los agentes (conocimiento/método), no acciones.
-- Importables desde repos públicos de GitHub. Se asignan por agente (agent_skills) y el runtime las
-- inyecta en el contexto del agente. RLS por marca, igual que agents/library_assets.

create table if not exists public.skills (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid references public.brands(id) on delete cascade,
  name text not null,
  description text not null default '',
  content text not null default '',
  source_repo text,
  source_path text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists skills_brand_idx on public.skills(brand_id);

create table if not exists public.agent_skills (
  agent_id uuid not null references public.agents(id) on delete cascade,
  skill_id uuid not null references public.skills(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (agent_id, skill_id)
);
create index if not exists agent_skills_skill_idx on public.agent_skills(skill_id);

alter table public.skills enable row level security;
alter table public.agent_skills enable row level security;

-- skills: lectura por acceso de marca (o globales); escritura por acceso de marca.
drop policy if exists skills_read on public.skills;
create policy skills_read on public.skills for select
  using ((brand_id is null) or has_brand_access(brand_id));
drop policy if exists skills_insert on public.skills;
create policy skills_insert on public.skills for insert
  with check (has_brand_access(brand_id));
drop policy if exists skills_update on public.skills;
create policy skills_update on public.skills for update
  using (has_brand_access(brand_id)) with check (has_brand_access(brand_id));
drop policy if exists skills_delete on public.skills;
create policy skills_delete on public.skills for delete
  using (has_brand_access(brand_id));

-- agent_skills: acceso derivado del agente (su marca).
drop policy if exists agent_skills_read on public.agent_skills;
create policy agent_skills_read on public.agent_skills for select using (
  exists (select 1 from public.agents a where a.id = agent_skills.agent_id and ((a.brand_id is null) or has_brand_access(a.brand_id)))
);
drop policy if exists agent_skills_insert on public.agent_skills;
create policy agent_skills_insert on public.agent_skills for insert with check (
  exists (select 1 from public.agents a where a.id = agent_skills.agent_id and ((a.brand_id is null) or has_brand_access(a.brand_id)))
);
drop policy if exists agent_skills_delete on public.agent_skills;
create policy agent_skills_delete on public.agent_skills for delete using (
  exists (select 1 from public.agents a where a.id = agent_skills.agent_id and ((a.brand_id is null) or has_brand_access(a.brand_id)))
);
