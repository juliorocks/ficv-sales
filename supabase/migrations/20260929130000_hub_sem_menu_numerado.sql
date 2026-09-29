-- Hub do Grupo (29/09): acaba o menu numerado. Uma só chamada de IA por mensagem do
-- contato classifica E, se ainda não der pra saber, já escreve a próxima pergunta em
-- linguagem natural (lógica nova em supabase/functions/_shared/hub.ts). O texto fixo
-- de menu não existe mais — vira instruções opcionais de tom pra IA.
ALTER TABLE vivaconnect_settings RENAME COLUMN hub_menu_template TO hub_ask_instructions;
ALTER TABLE vivaconnect_settings ALTER COLUMN hub_ask_instructions DROP NOT NULL;
ALTER TABLE vivaconnect_settings ALTER COLUMN hub_ask_instructions SET DEFAULT NULL;
-- quem nunca customizou o template antigo (ainda no valor padrão de fábrica) fica sem
-- instrução extra nenhuma; quem customizou, o texto vira ponto de partida das instruções
-- (o admin ajusta em Gestão > VivaConnect > Hub do Grupo).
UPDATE vivaconnect_settings SET hub_ask_instructions = NULL
 WHERE hub_ask_instructions = E'Olá{nome_virgula}! 👋 Você falou com o atendimento do *Grupo Cidade Viva*.\nPara te direcionar certinho, com quem você quer falar? Responda com o número:\n\n{opcoes}';

ALTER TABLE vivaconnect_settings RENAME COLUMN hub_max_menus TO hub_max_questions;

-- "hub_menu" (kind da fila de saída) vira "hub_ask" — mais preciso, já que não é mais menu.
-- Constraint precisa permitir os dois valores enquanto migra as linhas antigas, senão nem
-- o ADD CONSTRAINT (linhas existentes com 'hub_menu') nem o UPDATE (linhas virando 'hub_ask'
-- antes de 'hub_ask' ser permitido) passam.
ALTER TABLE vivaconnect_outbox DROP CONSTRAINT IF EXISTS vivaconnect_outbox_kind_check;
ALTER TABLE vivaconnect_outbox ADD CONSTRAINT vivaconnect_outbox_kind_check
  CHECK (kind IN ('first_message', 'student_reply', 'ai_reply', 'manual', 'hub_ask', 'hub_menu', 'hub_redirect', 'hub_forward'));
UPDATE vivaconnect_outbox SET kind = 'hub_ask' WHERE kind = 'hub_menu';
ALTER TABLE vivaconnect_outbox DROP CONSTRAINT vivaconnect_outbox_kind_check;
ALTER TABLE vivaconnect_outbox ADD CONSTRAINT vivaconnect_outbox_kind_check
  CHECK (kind IN ('first_message', 'student_reply', 'ai_reply', 'manual', 'hub_ask', 'hub_redirect', 'hub_forward'));
