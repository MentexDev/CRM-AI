-- F5 tope de costo: suma de tokens (metadata.usage.total_tokens) consumidos por un
-- agente HOY (desde date_trunc('day', now())). El runtime (agent_chat/agent_step) la
-- consulta antes de llamar al LLM; si el agente superó agent.config.daily_token_budget
-- (default 3M), corta fail-closed. Capa de gobernanza sobre el guard de loops.
create or replace function public.agent_tokens_today(p_agent_id uuid)
returns bigint language sql stable security definer set search_path = public as $$
  select coalesce(sum((metadata->'usage'->>'total_tokens')::bigint), 0)
  from messages
  where agent_id = p_agent_id
    and created_at >= date_trunc('day', now())
    and metadata->'usage'->>'total_tokens' is not null;
$$;
