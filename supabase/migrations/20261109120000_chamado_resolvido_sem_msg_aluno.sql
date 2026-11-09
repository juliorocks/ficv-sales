-- Chamado resolvido/fechado não recebe mais mensagem do aluno (pedido da equipe, 2026-11-09):
-- o aluno abre um novo chamado. A equipe continua podendo responder (e reabrir pela tela).
-- Não mexe nas outras partes da política: staff segue por ticket_visible().

DROP POLICY IF EXISTS tmsg_insert ON ticket_messages;
CREATE POLICY tmsg_insert ON ticket_messages FOR INSERT WITH CHECK (
  autor_id = auth.uid() AND EXISTS (
    SELECT 1 FROM tickets t
     WHERE t.id = ticket_messages.ticket_id
       AND ((t.aluno_id = auth.uid() AND ticket_messages.interno = false
             AND t.status NOT IN ('resolvido', 'fechado'))
            OR public.ticket_visible(t.queue_id, t.atendente_id, t.curso_id))));
