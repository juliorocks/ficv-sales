-- Inadimplência (turmas com Vigentes e Pré-Matrículas, como o "Integrantes" do Sponte): parcelas Pendentes vencidas (sponte_parcelas, preenchida pelo sync "abertas") por aluno,
-- com a matrícula mais relevante (Vigente primeiro) e o total de alunos Vigentes por turma.
CREATE OR REPLACE FUNCTION public.inadimplencia_report()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','agent','secretaria','coordenador')) THEN
    RAISE EXCEPTION 'sem permissão';
  END IF;

  WITH aberta AS (
    SELECT aluno_id, sacado, vencimento, valor_parcela, categoria, numero_parcela,
           (current_date - vencimento) AS atraso
    FROM sponte_parcelas
    WHERE situacao_parcela = 'Pendente' AND vencimento < current_date AND aluno_id IS NOT NULL
  ), mat AS (
    SELECT DISTINCT ON (aluno_id) aluno_id, aluno, nome_turma, nome_curso, situacao_id, situacao, celular
    FROM sponte_matriculas
    ORDER BY aluno_id, (situacao_id = 1) DESC, data_matricula DESC NULLS LAST
  ), por_aluno AS (
    SELECT a.aluno_id,
           coalesce(m.aluno, max(a.sacado)) AS nome,
           m.nome_turma AS turma, m.nome_curso AS curso, m.situacao, (m.situacao_id = 1) AS vigente, m.celular,
           count(*) AS parcelas, sum(a.valor_parcela) AS valor, max(a.atraso) AS atraso_max,
           sum(a.valor_parcela) FILTER (WHERE a.atraso <= 30) AS f30,
           sum(a.valor_parcela) FILTER (WHERE a.atraso BETWEEN 31 AND 60) AS f60,
           sum(a.valor_parcela) FILTER (WHERE a.atraso BETWEEN 61 AND 90) AS f90,
           sum(a.valor_parcela) FILTER (WHERE a.atraso > 90) AS f90p,
           jsonb_agg(jsonb_build_object('vencimento', a.vencimento, 'valor', a.valor_parcela, 'categoria', a.categoria, 'atraso', a.atraso) ORDER BY a.vencimento) AS detalhe
    FROM aberta a LEFT JOIN mat m ON m.aluno_id = a.aluno_id
    GROUP BY a.aluno_id, m.aluno, m.nome_turma, m.nome_curso, m.situacao, m.situacao_id, m.celular
  )
  SELECT jsonb_build_object(
    'alunos', coalesce((SELECT jsonb_agg(to_jsonb(p)) FROM por_aluno p), '[]'::jsonb),
    'turmas', coalesce((SELECT jsonb_agg(jsonb_build_object('turma', nome_turma, 'alunos', n, 'pre', pre))
                        FROM (SELECT nome_turma, count(DISTINCT aluno_id) FILTER (WHERE situacao_id = 1) AS n,
                                     count(DISTINCT aluno_id) FILTER (WHERE situacao_id = 6) AS pre
                              FROM sponte_matriculas WHERE situacao_id IN (1, 6) GROUP BY nome_turma) t WHERE n > 0 OR pre > 0), '[]'::jsonb),
    'sincronizado_em', (SELECT max(synced_at) FROM sponte_parcelas)
  ) INTO r;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.inadimplencia_report() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.inadimplencia_report() TO authenticated;
