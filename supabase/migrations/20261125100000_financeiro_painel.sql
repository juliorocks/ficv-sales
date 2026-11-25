-- Painel Financeiro do Sistema Pai (admin): Faculdade (sponte_*) e Escola (escola_sponte_*) lado a lado.
-- Devolve as duas empresas separadas; o consolidado é a soma feita na tela. Valores: previsto = valor de face
-- (valor_parcela); recebido = valor_pago. Parcela Cancelada e Renegociada ficam fora de tudo.
CREATE OR REPLACE FUNCTION public.financeiro_painel(p_inicio date, p_fim date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'sem permissão';
  END IF;

  WITH par AS (
    SELECT 'faculdade'::text AS empresa, situacao_parcela, vencimento, data_pagamento, valor_parcela, valor_pago,
           forma_cobranca, categoria, conta_creditar, bolsa_associada, aluno_id
    FROM sponte_parcelas WHERE situacao_parcela IN ('Quitada','Pendente')
    UNION ALL
    SELECT 'escola', situacao_parcela, vencimento, data_pagamento, valor_parcela, valor_pago,
           forma_cobranca, categoria, conta_creditar, bolsa_associada, aluno_id
    FROM escola_sponte_parcelas WHERE situacao_parcela IN ('Quitada','Pendente')
  ), mat AS (
    SELECT 'faculdade'::text AS empresa, aluno_id, situacao_id, data_matricula FROM sponte_matriculas
    UNION ALL
    SELECT 'escola', aluno_id, situacao_id, data_matricula FROM escola_sponte_matriculas
  ), emp AS (SELECT unnest(ARRAY['faculdade','escola']) AS empresa)
  SELECT jsonb_build_object(
    'kpis', (SELECT jsonb_agg(jsonb_build_object(
        'empresa', e.empresa,
        'recebido', coalesce((SELECT sum(valor_pago) FROM par p WHERE p.empresa = e.empresa AND p.situacao_parcela = 'Quitada' AND p.data_pagamento BETWEEN p_inicio AND p_fim), 0),
        'recebido_qtd', (SELECT count(*) FROM par p WHERE p.empresa = e.empresa AND p.situacao_parcela = 'Quitada' AND p.data_pagamento BETWEEN p_inicio AND p_fim),
        'previsto', coalesce((SELECT sum(valor_parcela) FROM par p WHERE p.empresa = e.empresa AND p.vencimento BETWEEN p_inicio AND p_fim), 0),
        'previsto_qtd', (SELECT count(*) FROM par p WHERE p.empresa = e.empresa AND p.vencimento BETWEEN p_inicio AND p_fim),
        'vencido', coalesce((SELECT sum(valor_parcela) FROM par p WHERE p.empresa = e.empresa AND p.situacao_parcela = 'Pendente' AND p.vencimento < current_date AND p.vencimento BETWEEN p_inicio AND p_fim), 0),
        'vencido_qtd', (SELECT count(*) FROM par p WHERE p.empresa = e.empresa AND p.situacao_parcela = 'Pendente' AND p.vencimento < current_date AND p.vencimento BETWEEN p_inicio AND p_fim),
        'vencido_base', coalesce((SELECT sum(valor_parcela) FROM par p WHERE p.empresa = e.empresa AND p.vencimento < current_date AND p.vencimento BETWEEN p_inicio AND p_fim), 0),
        'a_vencer', coalesce((SELECT sum(valor_parcela) FROM par p WHERE p.empresa = e.empresa AND p.situacao_parcela = 'Pendente' AND p.vencimento >= current_date AND p.vencimento BETWEEN p_inicio AND p_fim), 0),
        'a_vencer_qtd', (SELECT count(*) FROM par p WHERE p.empresa = e.empresa AND p.situacao_parcela = 'Pendente' AND p.vencimento >= current_date AND p.vencimento BETWEEN p_inicio AND p_fim),
        'alunos_vigentes', (SELECT count(DISTINCT aluno_id) FROM mat m WHERE m.empresa = e.empresa AND m.situacao_id = 1),
        'matriculas_periodo', (SELECT count(*) FROM mat m WHERE m.empresa = e.empresa AND m.data_matricula BETWEEN p_inicio AND p_fim),
        'com_bolsa', (SELECT count(*) FROM par p WHERE p.empresa = e.empresa AND p.vencimento BETWEEN p_inicio AND p_fim AND coalesce(p.bolsa_associada,'') <> ''),
        'desconto_medio', coalesce((SELECT round(avg((substring(p.bolsa_associada from '(\d+)\s*%'))::numeric), 1)
            FROM par p WHERE p.empresa = e.empresa AND p.vencimento BETWEEN p_inicio AND p_fim AND p.bolsa_associada ~ '\d+\s*%'), 0)
      )) FROM emp e),
    'mensal', coalesce((SELECT jsonb_agg(x ORDER BY (x->>'mes'), (x->>'empresa')) FROM (
        SELECT jsonb_build_object('empresa', empresa, 'mes', mes,
                 'previsto', sum(prev), 'recebido', sum(rec), 'vencido', sum(venc)) AS x
        FROM (
          SELECT empresa, to_char(vencimento, 'YYYY-MM') AS mes, valor_parcela AS prev, 0::numeric AS rec,
                 CASE WHEN situacao_parcela = 'Pendente' AND vencimento < current_date THEN valor_parcela ELSE 0 END AS venc
            FROM par WHERE vencimento BETWEEN p_inicio AND p_fim
          UNION ALL
          SELECT empresa, to_char(data_pagamento, 'YYYY-MM'), 0, valor_pago, 0
            FROM par WHERE situacao_parcela = 'Quitada' AND data_pagamento BETWEEN p_inicio AND p_fim
        ) u GROUP BY empresa, mes) q), '[]'::jsonb),
    'formas', coalesce((SELECT jsonb_agg(jsonb_build_object('empresa', empresa, 'forma', coalesce(forma_cobranca,'(sem forma)'), 'valor', v, 'qtd', n) ORDER BY v DESC)
        FROM (SELECT empresa, forma_cobranca, sum(valor_pago) v, count(*) n FROM par
              WHERE situacao_parcela = 'Quitada' AND data_pagamento BETWEEN p_inicio AND p_fim GROUP BY 1, 2) t), '[]'::jsonb),
    'categorias', coalesce((SELECT jsonb_agg(jsonb_build_object('empresa', empresa, 'categoria', coalesce(categoria,'(sem categoria)'), 'valor', v, 'qtd', n) ORDER BY v DESC)
        FROM (SELECT empresa, categoria, sum(valor_pago) v, count(*) n FROM par
              WHERE situacao_parcela = 'Quitada' AND data_pagamento BETWEEN p_inicio AND p_fim GROUP BY 1, 2) t), '[]'::jsonb),
    'contas', coalesce((SELECT jsonb_agg(jsonb_build_object('empresa', empresa, 'conta', coalesce(nullif(conta_creditar,''),'(sem conta)'), 'valor', v, 'qtd', n) ORDER BY v DESC)
        FROM (SELECT empresa, conta_creditar, sum(valor_pago) v, count(*) n FROM par
              WHERE situacao_parcela = 'Quitada' AND data_pagamento BETWEEN p_inicio AND p_fim GROUP BY 1, 2) t), '[]'::jsonb),
    'situacao_contratos', coalesce((SELECT jsonb_agg(jsonb_build_object('empresa', empresa, 'situacao_id', situacao_id, 'qtd', n))
        FROM (SELECT empresa, situacao_id, count(*) n FROM mat GROUP BY 1, 2) t), '[]'::jsonb),
    'sincronizado_em', jsonb_build_object(
        'faculdade', (SELECT max(synced_at) FROM sponte_parcelas),
        'escola', (SELECT max(synced_at) FROM escola_sponte_parcelas))
  ) INTO r;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.financeiro_painel(date, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.financeiro_painel(date, date) TO authenticated;
