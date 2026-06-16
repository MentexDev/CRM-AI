-- F4 backstop: reconcilia tareas padre 'blocked' cuyos hijos YA terminaron (ninguno
-- en to_do/in_progress) y sin aprobación pendiente → las reactiva a 'in_progress'.
-- Auto-sana carreras al terminar hijos concurrentes y reactivaciones perdidas.
-- La llama el heartbeat cada tick: db.rpc('reconcile_blocked_parents').
create or replace function public.reconcile_blocked_parents()
returns integer language sql security definer set search_path = public as $$
  with reactivated as (
    update tasks t set status = 'in_progress', updated_at = now()
    where t.status = 'blocked'
      and exists (select 1 from tasks c where c.parent_task_id = t.id)
      and not exists (select 1 from tasks c where c.parent_task_id = t.id and c.status in ('to_do','in_progress'))
      and not exists (select 1 from approvals a where a.task_id = t.id and a.status = 'pending')
    returning t.id
  )
  select count(*)::int from reactivated;
$$;
