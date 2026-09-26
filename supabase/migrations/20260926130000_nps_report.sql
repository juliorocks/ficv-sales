-- ============================================================================
-- Painel de NPS dos atendimentos (avaliações que o aluno responde ao fechar o chamado).
-- Decisão do usuário (26/09): Admin e Coordenadores veem tudo; cada atendente vê só
-- o próprio NPS.
--
-- Atribuição: se NENHUMA pessoa da equipe escreveu pro aluno no chamado (só o Tutor
-- Virtual), a nota é do "Tutor Virtual"; senão, do responsável (tickets.atendente_id).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.nps_report(p_from timestamptz DEFAULT now() - interval '90 days', p_to timestamptz DEFAULT now())
RETURNS TABLE (
  avaliacao_id bigint, avaliado_em timestamptz, nps integer, csat integer, ces integer, fcr boolean, comentario text,
  ticket_id bigint, protocolo text, titulo text, categoria text, fila text, curso text,
  atendente_id uuid, atendente text, atendido_por text, aluno text
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH quem AS (SELECT public.my_role() AS role, auth.uid() AS uid),
  base AS (
    SELECT e.id, e.created_at, e.nps_nota, e.csat_nota, e.ces_nota, e.fcr_resolvido, e.comentario,
           t.id AS tid, t.protocolo, t.titulo, t.categoria::text AS categoria, q.nome AS fila,
           coalesce(t.curso_nome, c.name) AS curso, t.atendente_id, p.full_name, t.aluno_nome,
           EXISTS (SELECT 1 FROM ticket_messages m
                    WHERE m.ticket_id = t.id AND NOT m.interno AND m.autor_role NOT IN ('aluno', 'tutor_virtual')) AS teve_humano
      FROM ticket_evaluations e
      JOIN tickets t ON t.id = e.ticket_id
      LEFT JOIN ticket_queues q ON q.id = t.queue_id
      LEFT JOIN courses c ON c.id = t.curso_id
      LEFT JOIN profiles p ON p.id = t.atendente_id
     WHERE e.created_at >= p_from AND e.created_at <= p_to
  )
  SELECT b.id, b.created_at, b.nps_nota, b.csat_nota, b.ces_nota, b.fcr_resolvido, b.comentario,
         b.tid, b.protocolo, b.titulo, b.categoria, b.fila, b.curso,
         CASE WHEN b.teve_humano THEN b.atendente_id END,
         CASE WHEN b.teve_humano THEN coalesce(b.full_name, 'Sem responsável') ELSE 'Tutor Virtual' END,
         CASE WHEN b.teve_humano THEN 'humano' ELSE 'tutor' END,
         b.aluno_nome
    FROM base b, quem
   WHERE quem.role IN ('admin', 'coordenador')
      OR (quem.role IN ('agent', 'secretaria', 'tutor') AND b.teve_humano AND b.atendente_id = quem.uid)
   ORDER BY b.created_at DESC;
$$;
REVOKE EXECUTE ON FUNCTION public.nps_report(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nps_report(timestamptz, timestamptz) TO authenticated;
