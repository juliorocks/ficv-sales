-- Tutor por curso (26/09): cada membro de fila pode ser limitado a cursos do catálogo
-- (ex.: Tutoria — Graduação: fulano só Direito, beltrano só Teologia EAD).
--   cursos NULL/vazio        → atende todos os chamados da fila (como antes)
--   chamado sem curso ligado  → visível pra todos da fila (não fica órfão)
ALTER TABLE public.ticket_queue_members ADD COLUMN IF NOT EXISTS cursos bigint[];

CREATE OR REPLACE FUNCTION public.ticket_visible(p_queue bigint, p_atendente uuid, p_curso bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN my_role() IN ('admin','agent','coordenador') THEN true
    WHEN my_role() IN ('secretaria','tutor','atendente','biblioteca') THEN p_atendente = auth.uid()
         OR EXISTS (SELECT 1 FROM ticket_queue_members m
                     WHERE m.queue_id = p_queue AND m.profile_id = auth.uid()
                       AND (coalesce(cardinality(m.cursos), 0) = 0 OR p_curso IS NULL OR p_curso = ANY(m.cursos)))
    ELSE false END;
$$;
-- versão antiga (sem curso) continua existindo pra quem ainda chamar
CREATE OR REPLACE FUNCTION public.ticket_visible(p_queue bigint, p_atendente uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT public.ticket_visible(p_queue, p_atendente, NULL::bigint) $$;

DROP POLICY IF EXISTS tickets_select ON tickets;
CREATE POLICY tickets_select ON tickets FOR SELECT USING (aluno_id = auth.uid() OR public.ticket_visible(queue_id, atendente_id, curso_id));
DROP POLICY IF EXISTS tickets_update ON tickets;
CREATE POLICY tickets_update ON tickets FOR UPDATE USING (aluno_id = auth.uid() OR public.ticket_visible(queue_id, atendente_id, curso_id));
DROP POLICY IF EXISTS tmsg_select ON ticket_messages;
CREATE POLICY tmsg_select ON ticket_messages FOR SELECT USING (EXISTS (
  SELECT 1 FROM tickets t WHERE t.id = ticket_messages.ticket_id
    AND ((t.aluno_id = auth.uid() AND ticket_messages.interno = false) OR public.ticket_visible(t.queue_id, t.atendente_id, t.curso_id))));
