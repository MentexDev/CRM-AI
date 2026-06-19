-- "Stop" de un turno del chat: el cliente marca conversations.canceled_at y el loop de
-- runAgentChatTurn (agent_chat.ts) corta cuando ese valor CAMBIA respecto al inicio del turno.
-- El cliente puede actualizarlo gracias a la policy UPDATE existente (created_by/has_brand_access).
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS canceled_at timestamptz;
