-- F5 gobernanza: marca tareas atascadas como 'needs_review' para que un humano las
-- revise (y, si son hijas, liberen al padre vía reconcile_blocked_parents). Una tarea
-- está "atascada" si lleva >45min sin cambio de estado (posible agente disabled o
-- abandono) o si el agente acumuló >50 turnos en ella (loop / re-delegación infinita).
-- La llama el heartbeat cada tick, antes de reconcile_blocked_parents.
create or replace function public.reconcile_stuck_tasks()
returns integer language sql security definer set search_path = public as $$
  with stuck as (
    update tasks t set
      status = 'needs_review',
      result = coalesce(t.result, '{}'::jsonb) || jsonb_build_object(
        'governance', 'auto: marcada para revision (sin progreso >45min o >50 turnos del agente)',
        'flagged_at', now()
      )
    where t.status in ('to_do','in_progress')
      and (
        t.updated_at < now() - interval '45 minutes'
        or (select count(*) from messages m where m.task_id = t.id and m.role = 'assistant') > 50
      )
    returning t.id
  )
  select count(*)::int from stuck;
$$;
