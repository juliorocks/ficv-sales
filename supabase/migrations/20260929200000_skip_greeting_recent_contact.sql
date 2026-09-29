-- Pedido do usuário (29/09): se o lead reabriu a conversa recentemente (mesmo dia, últimos
-- 1-2 dias), não repetir a saudação/"1ª mensagem" de novo — a IA já responde direto ao que
-- ele perguntou. Achado ao vivo: lead pediu contato da Igreja (handoff pra outra empresa,
-- que ENCERRA o atendimento da Faculdade — ver migration 20260929xxxxx da transferência de
-- setor), 12 min depois voltou perguntando sobre Direito, e levou a saudação inteira nova
-- de novo, porque a sessão tinha sido apagada.
ALTER TABLE ai_agent_settings
  ADD COLUMN IF NOT EXISTS first_message_skip_hours numeric NOT NULL DEFAULT 48;
