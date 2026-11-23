-- Envio avulso da régua (2026-11-23): parcelas pendentes de alunos escolhidos pelo painel, sem janela de 1 dia,
-- sem checar o que já foi enviado e sem exigir matrícula Vigente (a equipe decide). Etapa = a mais avançada já atingida
-- (dias <= atraso); parcela que ainda não venceu cai na etapa mais antiga. Só parcelas com atraso >= -5 (as de meses futuros ficam de fora).
CREATE OR REPLACE FUNCTION public.regua_cobranca_avulso(p_hoje date, p_aluno_ids integer[], p_canal text)
RETURNS TABLE(aluno_id integer, nome text, email text, celular text, conta_receber_id bigint, numero_parcela text,
              vencimento date, etapa_id integer, dias integer, atraso integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.aluno_id, COALESCE(a.nome, p.sacado),
         COALESCE(NULLIF(CASE WHEN a.email LIKE '%@aluno.ficv.br' THEN NULL ELSE a.email END, ''), NULLIF(c.email, '')),
         COALESCE(NULLIF(c.celular, ''), NULLIF(a.telefone, ''), NULLIF(c.telefone, '')),
         p.conta_receber_id, p.numero_parcela, p.vencimento, e.id, e.dias, (p_hoje - p.vencimento)
    FROM sponte_parcelas p
    LEFT JOIN alunos a ON a.sponte_aluno_id = p.aluno_id
    LEFT JOIN sponte_alunos_contato c ON c.aluno_id = p.aluno_id
    CROSS JOIN LATERAL (
      SELECT e.id, e.dias, e.whatsapp_template FROM regua_cobranca_etapas e
       WHERE e.ativo
       ORDER BY (e.dias <= (p_hoje - p.vencimento)) DESC,
                CASE WHEN e.dias <= (p_hoje - p.vencimento) THEN e.dias END DESC NULLS LAST,
                e.dias ASC
       LIMIT 1) e
   WHERE p.aluno_id = ANY (p_aluno_ids)
     AND p.situacao_parcela = 'Pendente'
     AND (p_hoje - p.vencimento) >= -5
     AND (p_canal <> 'whatsapp' OR COALESCE(e.whatsapp_template, '') <> '');
$$;
REVOKE ALL ON FUNCTION public.regua_cobranca_avulso(date, integer[], text) FROM PUBLIC, anon, authenticated;
