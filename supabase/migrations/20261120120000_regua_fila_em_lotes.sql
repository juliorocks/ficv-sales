-- Régua em lotes (2026-11-20): o que não cabe no teto diário do e-mail segue na fila nos dias seguintes.
-- Etapa da parcela = a mais avançada já atingida (dias <= atraso). Ela continua elegível até a próxima etapa chegar;
-- a última etapa (+20) vale por mais 10 dias. Parcela já avisada naquela etapa (ou numa mais avançada) não repete.
ALTER TABLE public.regua_cobranca_config ALTER COLUMN limite_email_dia SET DEFAULT 40;
UPDATE public.regua_cobranca_config SET limite_email_dia = 40 WHERE id = 1 AND limite_email_dia = 60;

CREATE OR REPLACE FUNCTION public.regua_cobranca_candidatos(p_hoje date, p_canal text)
RETURNS TABLE(aluno_id integer, nome text, email text, celular text, conta_receber_id bigint, numero_parcela text,
              vencimento date, etapa_id integer, dias integer, atraso integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.aluno_id, COALESCE(a.nome, p.sacado),
         COALESCE(NULLIF(CASE WHEN a.email LIKE '%@aluno.ficv.br' THEN NULL ELSE a.email END, ''), NULLIF(c.email, '')),
         COALESCE(NULLIF(c.celular, ''), NULLIF(a.telefone, ''), NULLIF(c.telefone, '')),
         p.conta_receber_id, p.numero_parcela, p.vencimento, e.id, e.dias, (p_hoje - p.vencimento)
    FROM sponte_parcelas p
    CROSS JOIN LATERAL (
      SELECT e1.* FROM regua_cobranca_etapas e1
       WHERE e1.ativo AND e1.dias <= (p_hoje - p.vencimento)
       ORDER BY e1.dias DESC LIMIT 1) e
    LEFT JOIN alunos a ON a.sponte_aluno_id = p.aluno_id
    LEFT JOIN sponte_alunos_contato c ON c.aluno_id = p.aluno_id
   WHERE p.situacao_parcela = 'Pendente'
     AND p.vencimento BETWEEN p_hoje - 40 AND p_hoje + 6
     AND ((p_hoje - p.vencimento) - e.dias <= 10 OR e.dias < (SELECT max(dias) FROM regua_cobranca_etapas WHERE ativo))
     AND (p_canal <> 'whatsapp' OR COALESCE(e.whatsapp_template, '') <> '')
     AND EXISTS (SELECT 1 FROM sponte_matriculas m WHERE m.aluno_id = p.aluno_id AND m.situacao_id = 1)
     AND NOT EXISTS (SELECT 1 FROM regua_cobranca_envios v JOIN regua_cobranca_etapas e2 ON e2.id = v.etapa_id
                      WHERE v.conta_receber_id IS NOT DISTINCT FROM p.conta_receber_id
                        AND v.numero_parcela IS NOT DISTINCT FROM p.numero_parcela
                        AND v.canal = p_canal AND v.status = 'enviado' AND e2.dias >= e.dias);
$$;
REVOKE ALL ON FUNCTION public.regua_cobranca_candidatos(date, text) FROM PUBLIC, anon, authenticated;
