-- ============================================================
-- Registra o evento "accept_attendance" (agente aceitou um
-- atendimento da fila de espera) do webhook do WideChat.
-- agent_id aqui é o ID interno do WideChat (não bate com
-- profiles.id) — a resolução do nome do agente é feita depois,
-- casando "protocol" com messages_logs.agent_name.
-- ============================================================

CREATE TABLE IF NOT EXISTS widechat_atendimentos (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id           INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  protocol          TEXT,
  widechat_agent_id TEXT,
  session_id        TEXT,
  contact_id        TEXT,
  aceito_em         TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_widechat_atendimentos_protocol ON widechat_atendimentos(protocol);
CREATE INDEX IF NOT EXISTS idx_widechat_atendimentos_lead_id ON widechat_atendimentos(lead_id);

ALTER TABLE widechat_atendimentos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_read" ON widechat_atendimentos
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "admin_write" ON widechat_atendimentos
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );
