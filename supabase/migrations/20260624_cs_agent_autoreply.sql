-- Auto-respuesta del agente vendedor en Atención al Cliente.
-- Cada canal puede tener un agente asignado + toggle de respuesta automática; cada conversación
-- puede pausar el agente (handoff humano: cuando un operador responde, agent_active=false).
alter table public.cs_channels add column if not exists agent_id uuid references public.agents(id) on delete set null;
alter table public.cs_channels add column if not exists auto_reply boolean not null default false;
alter table public.cs_conversations add column if not exists agent_active boolean not null default true;
