-- Mensagem de despedida ao Finalizar o atendimento (29/09, pedido do usuário): configurável
-- em Gestão > VivaConnect, já nasce LIGADA com um texto padrão (o usuário pediu pra já
-- cadastrar uma). Sai pelo mesmo worker/outbox dos outros templates (kind 'farewell'),
-- sem trava de janela/Meta (mesma regra do envio manual — é uma ação deliberada da equipe).
ALTER TABLE vivaconnect_settings
  ADD COLUMN IF NOT EXISTS farewell_message_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS farewell_message_template text NOT NULL DEFAULT
    E'Foi um prazer falar com você{nome_virgula}! 💙 Ficamos à disposição sempre que precisar — é só chamar por aqui. Até logo!';

ALTER TABLE vivaconnect_outbox DROP CONSTRAINT IF EXISTS vivaconnect_outbox_kind_check;
ALTER TABLE vivaconnect_outbox ADD CONSTRAINT vivaconnect_outbox_kind_check
  CHECK (kind IN ('first_message', 'student_reply', 'ai_reply', 'manual', 'hub_ask', 'hub_redirect', 'hub_forward', 'farewell'));
