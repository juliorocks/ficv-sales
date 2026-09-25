-- ============================================================================
-- Tutor Virtual — IA que responde PRIMEIRO todo chamado do Portal do Aluno
-- (decisão do usuário 25/09), com base de conhecimento dos ALUNOS e consulta ao
-- Sponte do próprio aluno. Passa pra fila humana quando não resolve.
--
-- knowledge_base.publico: 'vendas' (IA do WhatsApp/leads) | 'alunos' (Tutor
--   Virtual) | 'ambos'. Os 15 docs atuais são de vendas.
-- tickets.ai_status: 'active' (tutor conduz) | 'handed_off' (equipe humana) | 'off'
-- Gatilho: mensagem do aluno num chamado com ai_status='active' → chama a edge
--   function tutor-virtual (assíncrono, via public.cron_call / x-cron-key).
-- Humano respondendo (mensagem pública da equipe) → tutor sai daquele chamado.
-- ============================================================================

ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS publico text NOT NULL DEFAULT 'vendas'
  CHECK (publico IN ('vendas','alunos','ambos'));

DROP FUNCTION IF EXISTS public.match_knowledge_chunks(extensions.vector, integer, double precision);
CREATE OR REPLACE FUNCTION public.match_knowledge_chunks(
  query_embedding extensions.vector(1536),
  match_count     integer DEFAULT 6,
  min_similarity  double precision DEFAULT 0.25,
  p_publico       text DEFAULT 'vendas'
) RETURNS TABLE (document_id uuid, title text, category text, content text, similarity double precision)
LANGUAGE sql STABLE SET search_path = public, extensions AS $$
  SELECT c.document_id, kb.title, kb.category, c.content,
         1 - (c.embedding <=> query_embedding) AS similarity
    FROM knowledge_chunks c
    JOIN knowledge_base kb ON kb.id = c.document_id
   WHERE kb.ai_enabled
     AND kb.publico IN (p_publico, 'ambos')
     AND 1 - (c.embedding <=> query_embedding) >= min_similarity
   ORDER BY c.embedding <=> query_embedding
   LIMIT match_count;
$$;
REVOKE EXECUTE ON FUNCTION public.match_knowledge_chunks(extensions.vector, integer, double precision, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.match_knowledge_chunks(extensions.vector, integer, double precision, text) TO service_role;

-- ── configuração (linha única) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tutor_settings (
  id              smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled         boolean NOT NULL DEFAULT false,
  nome            text    NOT NULL DEFAULT 'Tutor Virtual',
  system_prompt   text    NOT NULL DEFAULT
'Você é o Tutor Virtual da FICV (Faculdade Internacional Cidade Viva) e atende ALUNOS pelo Portal do Aluno, dentro de um chamado.

Como atender:
- Seja cordial, claro e objetivo. Parágrafos curtos. Trate o aluno pelo primeiro nome.
- Use as FERRAMENTAS para consultar os dados do próprio aluno no sistema acadêmico (matrículas, financeiro, notas, link de pagamento) sempre que a pergunta depender disso. Nunca invente valores, datas, notas ou situações.
- Para regras, prazos e procedimentos da faculdade, responda SOMENTE com base na base de conhecimento fornecida.
- Se a informação não estiver disponível, diga que vai passar para a equipe.
- Ao final de cada resposta, pergunte se resolveu ou se o aluno precisa de mais alguma coisa.',
  handoff_instructions text NOT NULL DEFAULT
'Passe para a equipe humana (handoff) quando:
- o aluno pedir para falar com uma pessoa, secretaria, tutor ou coordenação;
- envolver negociação de dívida, desconto, bolsa, cancelamento, trancamento, transferência, revisão de nota ou emissão de documento oficial (declaração, histórico, certificado);
- houver reclamação, insatisfação ou assunto delicado;
- a base de conhecimento e as ferramentas não trouxerem a resposta.',
  chat_model      text    NOT NULL DEFAULT 'gpt-4.1-mini',
  temperature     numeric NOT NULL DEFAULT 0.3,
  max_turns       integer NOT NULL DEFAULT 8,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid REFERENCES profiles(id) ON DELETE SET NULL
);
INSERT INTO tutor_settings (id) VALUES (1) ON CONFLICT DO NOTHING;
ALTER TABLE tutor_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY tutor_settings_sel ON tutor_settings FOR SELECT USING (public.is_ticket_staff());
CREATE POLICY tutor_settings_admin ON tutor_settings FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ── estado do tutor em cada chamado ─────────────────────────────────────────
ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS ai_status text NOT NULL DEFAULT 'active' CHECK (ai_status IN ('active','handed_off','off')),
  ADD COLUMN IF NOT EXISTS ai_turns  integer NOT NULL DEFAULT 0;
-- chamados que já existiam: humanos seguem
UPDATE tickets SET ai_status = 'off' WHERE created_at < now();

-- aluno escreveu → tutor responde (assíncrono). Equipe escreveu → tutor sai.
CREATE OR REPLACE FUNCTION public.ticket_tutor_on_message() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t record; on_ boolean;
BEGIN
  IF coalesce(NEW.interno, false) THEN RETURN NEW; END IF;
  SELECT id, ai_status, origem INTO t FROM tickets WHERE id = NEW.ticket_id;
  IF NEW.autor_role = 'aluno' THEN
    SELECT enabled INTO on_ FROM tutor_settings WHERE id = 1;
    IF coalesce(on_, false) AND t.ai_status = 'active' THEN
      PERFORM public.cron_call('tutor-virtual', jsonb_build_object('ticket_id', NEW.ticket_id, 'message_id', NEW.id));
    END IF;
  ELSIF NEW.autor_role NOT IN ('tutor_virtual') AND t.ai_status = 'active' AND t.origem <> 'transferencia' THEN
    UPDATE tickets SET ai_status = 'handed_off' WHERE id = NEW.ticket_id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_ticket_tutor_on_message ON ticket_messages;
CREATE TRIGGER trg_ticket_tutor_on_message AFTER INSERT ON ticket_messages
  FOR EACH ROW EXECUTE FUNCTION public.ticket_tutor_on_message();

-- chamado transferido pela equipe (Comercial → Secretaria) já vem com humano: tutor fora
CREATE OR REPLACE FUNCTION public.ticket_tutor_default() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.origem = 'transferencia' THEN NEW.ai_status := 'off'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_ticket_tutor_default ON tickets;
CREATE TRIGGER trg_ticket_tutor_default BEFORE INSERT ON tickets
  FOR EACH ROW EXECUTE FUNCTION public.ticket_tutor_default();
