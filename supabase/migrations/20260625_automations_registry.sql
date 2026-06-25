-- Registro de AUTOMATIZACIONES del CRM (crons / tareas programadas) para verlas en el dashboard de Agentes.
-- Cada vez que se cree una automatización (p.ej. un cron.schedule nuevo), registrar también un row aquí
-- para que aparezca en el home de Agentes. Datos NO sensibles (nombre/horario/agente), nunca el comando.
create table if not exists public.automations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  schedule_human text,          -- "Todos los días · 7:00 a.m. (Colombia)"
  cron_jobname text,            -- referencia al job de pg_cron (p.ej. 'daily-sales-report-7am-col')
  agent_id uuid references public.agents(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.automations enable row level security;
-- Lectura para cualquier usuario autenticado (sólo nombres/horarios, no datos sensibles).
-- Escritura: sólo service_role (las automatizaciones se registran por migración), que bypassa RLS.
drop policy if exists automations_read on public.automations;
create policy automations_read on public.automations for select to authenticated using (true);

-- Sembrar la automatización del reporte diario (inventarista-crm). Idempotente por cron_jobname.
insert into public.automations (name, description, schedule_human, cron_jobname, agent_id, active)
select
  'Reporte de ventas diario',
  'Trae las ventas del día anterior del CRM (SuiteCRM) y deja un resumen claro.',
  'Todos los días · 7:00 a.m. (Colombia)',
  'daily-sales-report-7am-col',
  (select id from public.agents where slug = 'inventarista-crm' limit 1),
  true
where not exists (select 1 from public.automations where cron_jobname = 'daily-sales-report-7am-col');
