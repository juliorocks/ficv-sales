-- Notificação de chamado também por WhatsApp (não oficial, canal pool/Baileys — sem custo
-- Meta) — pedido do usuário 02/10: "muita gente não fica abrindo e-mail". Novo kind no
-- outbox do VivaConnect; o envio em si é disparado por ticket-emails (mesmos gatilhos/fila
-- que já existem pro e-mail, ver 20260925260000_portal_aluno.sql) — não duplica trigger
-- nenhum, só manda uma 2ª mensagem (curta) quando o aluno tem telefone.
ALTER TABLE vivaconnect_outbox DROP CONSTRAINT IF EXISTS vivaconnect_outbox_kind_check;
ALTER TABLE vivaconnect_outbox ADD CONSTRAINT vivaconnect_outbox_kind_check
  CHECK (kind IN ('first_message', 'student_reply', 'ai_reply', 'manual', 'hub_ask', 'hub_redirect', 'hub_forward', 'farewell', 'ticket_notice'));
