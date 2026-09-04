-- ============================================================================
-- widechat_blocklist_contacts: memória DURÁVEL de telefones não-comerciais.
--
-- Problema achado (2026-09-04): o filtro de setor (RH/Secretaria/Escola/
-- Fundação/Igreja) só consegue identificar o setor quando a MENSAGEM QUE
-- CHEGA é de um agente cujo nome aparece no payload (content.user.name) ou
-- bate com palavra-chave. Só que boa parte das mensagens de uma conversa são
-- do PRÓPRIO CLIENTE (sem nome de agente nenhum) — nessas, isNonCommercial
-- dá false e, se o lead já tinha sido apagado numa mensagem anterior do
-- agente, ele **renasce** na próxima mensagem do cliente. Resultado: lead de
-- Igreja/RH fica entrando e saindo do Kanban toda vez que o cliente manda
-- "Ok, obrigada" — o usuário via ele "sempre voltando".
--
-- Fix: memorizar por TELEFONE que aquele contato é não-comercial, assim que
-- descobrimos isso (via agente/fila/roster), e checar essa memória ANTES de
-- tudo em toda mensagem seguinte — independente de quem "aparenta" estar
-- falando naquele evento específico.
-- ============================================================================

CREATE TABLE IF NOT EXISTS widechat_blocklist_contacts (
  telefone   text PRIMARY KEY,
  motivo     text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_widechat_blocklist_telefone ON widechat_blocklist_contacts (telefone);

ALTER TABLE widechat_blocklist_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY widechat_blocklist_service_all ON widechat_blocklist_contacts
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY widechat_blocklist_staff_read ON widechat_blocklist_contacts
  FOR SELECT TO authenticated USING (is_staff());
