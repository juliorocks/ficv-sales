-- Follow-up com envio automático (pedido do usuário 29/09): quando o "Retornar em" chega,
-- a Vivi escreve uma mensagem de retomada com base na nota do atendente e manda pro lead —
-- sem precisar ninguém lembrar de voltar lá. `auto_send` vem TRUE por padrão (usuário pediu
-- "check pra desmarcar", não pra marcar); só desliga quem explicitamente não quiser.
ALTER TABLE lead_followups ADD COLUMN IF NOT EXISTS auto_send boolean NOT NULL DEFAULT true;
-- follow-up disparado sozinho fica marcado, pra diferenciar de quem clicou "Concluir" na mão
ALTER TABLE lead_followups ADD COLUMN IF NOT EXISTS auto_sent_at timestamptz;

-- índice pro dispatcher achar rápido os vencidos com auto-envio ligado
CREATE INDEX IF NOT EXISTS idx_lead_followups_due_auto
  ON lead_followups (due_at) WHERE status = 'pending' AND auto_send;
