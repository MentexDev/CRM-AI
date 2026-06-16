-- F5 observabilidad: salud del motor para el panel "Salud" (junta-only). Devuelve en
-- un solo jsonb: tokens consumidos hoy por agente, conteo de tareas por estado,
-- aprobaciones pendientes, tool calls y fallos de tools del día. Gated por is_junta()
-- para no filtrar datos cross-marca (SECURITY DEFINER salta RLS).
create or replace function public.engine_health()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not public.is_junta() then jsonb_build_object('error','forbidden')
  else jsonb_build_object(
    'agents', (select coalesce(jsonb_agg(jsonb_build_object('slug',a.slug,'name',a.name,'status',a.status,'role',a.role,'tokens_today',public.agent_tokens_today(a.id)) order by a.name),'[]'::jsonb) from agents a),
    'tasks', (select coalesce(jsonb_object_agg(status,c),'{}'::jsonb) from (select status,count(*) c from tasks group by status) t),
    'pending_approvals', (select count(*) from approvals where status='pending'),
    'tool_failures_today', (select count(*) from tool_calls where status='failed' and completed_at >= date_trunc('day',now())),
    'tool_calls_today', (select count(*) from tool_calls where completed_at >= date_trunc('day',now())),
    'generated_at', now()
  ) end;
$$;
