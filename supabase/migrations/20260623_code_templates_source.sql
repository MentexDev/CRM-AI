-- Origen del artefacto de cada plantilla (para "Abrir Code" → abre el chat Y activa la pestaña en el canvas).
alter table public.code_templates add column if not exists source_conversation_id uuid;
alter table public.code_templates add column if not exists source_artifact_key text;
