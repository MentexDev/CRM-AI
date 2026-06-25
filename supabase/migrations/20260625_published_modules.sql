-- MÓDULOS PUBLICADOS: una plantilla del agente Code (document/sheet/board/slides) "publicada" como
-- módulo navegable a pantalla completa, accesible desde el switcher horizontal del sidebar.
-- Es una FOTO (snapshot) del artefacto al momento de publicar: para actualizarlo, se re-publica.
create table if not exists public.published_modules (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  kind text not null,                       -- document | sheet | board | slides
  data jsonb not null default '{}'::jsonb,   -- snapshot del payload del artefacto (markdown / columns+rows / nodes+edges / slides)
  source_conversation_id uuid,              -- para "Abrir en Code" y seguir editando
  source_artifact_key text,
  agent_id uuid references public.agents(id) on delete set null,
  brand_id uuid,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.published_modules enable row level security;
-- Contenido de equipo (no sensible): lectura/creación/borrado para usuarios autenticados.
drop policy if exists pm_read on public.published_modules;
create policy pm_read on public.published_modules for select to authenticated using (true);
drop policy if exists pm_insert on public.published_modules;
create policy pm_insert on public.published_modules for insert to authenticated with check (true);
drop policy if exists pm_delete on public.published_modules;
create policy pm_delete on public.published_modules for delete to authenticated using (true);

-- Realtime para que el módulo aparezca/desaparezca al instante en el switcher.
do $$ begin
  alter publication supabase_realtime add table public.published_modules;
exception when others then null; end $$;
