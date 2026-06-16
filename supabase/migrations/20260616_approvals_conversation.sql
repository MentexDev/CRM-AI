-- Aprobación auto-resume en el chat: liga cada approval a la conversación que lo
-- originó (cuando nace de un chat, no de una tarea autónoma). Así execute-approval
-- puede postear el resultado y el cierre del agente DE VUELTA en el chat (vía realtime),
-- en vez de dejar el mensaje huérfano (solo agent_id+task_id) e invisible para el hilo.
alter table public.approvals
  add column if not exists conversation_id uuid references public.conversations(id) on delete set null;

create index if not exists idx_approvals_conversation on public.approvals(conversation_id);
