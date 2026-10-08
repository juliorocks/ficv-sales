-- Rastreia chamados resolvidos 100% pelo Tutor Virtual, sem nenhum agente humano
-- responder ao aluno (pedido do usuário 08/10: selo de robozinho no card + % no Painel).
--
-- ai_resolved é recalculado TODA VEZ que o status entra em resolvido/fechado (trigger
-- BEFORE UPDATE), olhando se já existe alguma mensagem de autor_role='atendente' não
-- interna nesse chamado. Funciona igual pra qualquer caminho que resolve um chamado hoje
-- (Tutor Virtual sozinho, aluno encerrando o próprio chamado, agente resolvendo manual) —
-- não precisou mexer em nenhum desses pontos no código.

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS ai_resolved boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.set_ticket_ai_resolved() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IN ('resolvido', 'fechado') AND OLD.status IS DISTINCT FROM NEW.status THEN
    NEW.ai_resolved := NOT EXISTS (
      SELECT 1 FROM ticket_messages
      WHERE ticket_id = NEW.id AND autor_role = 'atendente' AND interno = false
    );
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_set_ticket_ai_resolved ON tickets;
CREATE TRIGGER trg_set_ticket_ai_resolved BEFORE UPDATE OF status ON tickets
  FOR EACH ROW EXECUTE FUNCTION public.set_ticket_ai_resolved();

-- backfill do histórico (chamados que já estavam resolvido/fechado antes desta migration)
UPDATE tickets t SET ai_resolved = NOT EXISTS (
  SELECT 1 FROM ticket_messages m WHERE m.ticket_id = t.id AND m.autor_role = 'atendente' AND m.interno = false
) WHERE t.status IN ('resolvido', 'fechado');

-- Encerramento automático por silêncio do aluno (achado ao vivo 08/10: chamado respondido
-- de verdade pelo Tutor — aluno pediu o link do boleto, recebeu — mas como ninguém mais
-- escreveu depois, ficava preso pra sempre em "Aguardando Aluno" porque a função só roda
-- quando o aluno manda mensagem nova; sem gatilho, sem reavaliação). Mesmo padrão já usado
-- pros leads (ai_agent_settings.followup_giveup_*), agora pro Tutor Virtual.
ALTER TABLE tutor_settings ADD COLUMN IF NOT EXISTS auto_resolve_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE tutor_settings ADD COLUMN IF NOT EXISTS auto_resolve_hours integer NOT NULL DEFAULT 24;
