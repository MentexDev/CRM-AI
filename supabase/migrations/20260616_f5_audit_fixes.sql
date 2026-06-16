-- Fixes de la auditoría C-A-R de F5 (HIGH de seguridad/correctitud). Append-only.

-- [HIGH] reconcile_stuck_tasks usaba tasks.updated_at (congelado en el último cambio de
-- estado) → falsos positivos (marcaba needs_review tareas activas o 'to_do' en espera).
-- Ahora mide ACTIVIDAD REAL (mensajes) y SOLO toca 'in_progress': atascada = >45min en
-- in_progress SIN mensajes recientes (agente colgado/disabled) o >50 turnos (loop).
create or replace function public.reconcile_stuck_tasks()
returns integer language sql security definer set search_path = public as $$
  with stuck as (
    update tasks t set
      status = 'needs_review',
      result = coalesce(t.result, '{}'::jsonb) || jsonb_build_object(
        'governance', 'auto: in_progress sin actividad >45min o >50 turnos del agente',
        'flagged_at', now()
      )
    where t.status = 'in_progress'
      and t.updated_at < now() - interval '45 minutes'
      and (
        not exists (select 1 from messages m where m.task_id = t.id and m.created_at > now() - interval '45 minutes')
        or (select count(*) from messages m where m.task_id = t.id and m.role = 'assistant') > 50
      )
    returning t.id
  )
  select count(*)::int from stuck;
$$;

-- [HIGH] perf: agent_tokens_today suma sobre messages del día — índice para que no
-- degrade (ni cause statement-timeout → fail-closed bloqueando el chat) al crecer.
create index if not exists idx_messages_agent_created on public.messages(agent_id, created_at);

-- [HIGH] las RPCs de gobernanza eran SECURITY DEFINER y EXECUTE para anon/authenticated
-- → cualquier usuario podía MUTAR tareas de todas las marcas (reconcile_*) o leer uso de
-- tokens cross-marca (agent_tokens_today). Las restringimos a service_role (heartbeat/runtime).
-- engine_health NO se toca: la consume el frontend (authenticated) y ya está gateada por is_junta().
revoke execute on function public.reconcile_stuck_tasks() from public, anon, authenticated;
revoke execute on function public.reconcile_blocked_parents() from public, anon, authenticated;
revoke execute on function public.agent_tokens_today(uuid) from public, anon, authenticated;
grant execute on function public.reconcile_stuck_tasks() to service_role;
grant execute on function public.reconcile_blocked_parents() to service_role;
grant execute on function public.agent_tokens_today(uuid) to service_role;
