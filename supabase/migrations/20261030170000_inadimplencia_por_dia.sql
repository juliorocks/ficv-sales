-- Série de inadimplência por DIA de vencimento (a tela agrupa em mês ou dia e aplica o filtro de datas), parcelas já vencidas (sem as canceladas) e quanto
-- delas segue Pendente (só de 2026-01 em diante: antes disso o sync só trouxe parcela paga), por curso da matrícula mais relevante do aluno (Vigente primeiro).
CREATE OR REPLACE FUNCTION public.inadimplencia_mensal()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','agent','secretaria','coordenador')) THEN
    RAISE EXCEPTION 'sem permissão';
  END IF;

  WITH mat AS (
    SELECT DISTINCT ON (aluno_id) aluno_id, nome_curso, (situacao_id = 1) AS vigente
    FROM sponte_matriculas
    ORDER BY aluno_id, (situacao_id = 1) DESC, data_matricula DESC NULLS LAST
  ), g AS (
    SELECT to_char(p.vencimento, 'YYYY-MM-DD') AS dia,
           coalesce(m.nome_curso, 'Sem matrícula') AS curso, coalesce(m.vigente, false) AS vigente,
           count(*) AS parcelas, sum(p.valor_parcela) AS valor,
           count(*) FILTER (WHERE p.situacao_parcela = 'Pendente') AS parcelas_abertas,
           coalesce(sum(p.valor_parcela) FILTER (WHERE p.situacao_parcela = 'Pendente'), 0) AS valor_aberto,
           count(DISTINCT p.aluno_id) AS alunos,
           count(DISTINCT p.aluno_id) FILTER (WHERE p.situacao_parcela = 'Pendente') AS alunos_abertos
    FROM sponte_parcelas p LEFT JOIN mat m ON m.aluno_id = p.aluno_id
    WHERE p.vencimento >= date '2026-01-01' AND p.vencimento < current_date AND p.situacao_parcela <> 'Cancelada' AND p.aluno_id IS NOT NULL
    GROUP BY 1, 2, 3
  )
  SELECT coalesce(jsonb_agg(to_jsonb(g) ORDER BY dia), '[]'::jsonb) INTO r FROM g;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.inadimplencia_mensal() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.inadimplencia_mensal() TO authenticated;
