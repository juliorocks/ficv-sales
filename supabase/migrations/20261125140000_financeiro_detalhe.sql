-- Detalhes do painel Financeiro (admin): drilldown dos cartões, DRE de competência, fluxo de caixa,
-- conciliação (recebimentos por conta/dia) e verificações automáticas. Duas empresas separadas; a tela consolida.
CREATE OR REPLACE FUNCTION public.financeiro_detalhe(p_inicio date, p_fim date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'sem permissão';
  END IF;

  WITH par AS MATERIALIZED (
    SELECT 'faculdade'::text AS empresa, situacao_parcela AS sit, vencimento AS v, data_pagamento AS dp, valor_parcela AS face,
           valor_pago AS pago, forma_cobranca AS forma, categoria AS cat, conta_creditar AS conta, sacado,
           coalesce(nullif(substring(bolsa_associada from '(\d+)\s*%'), '')::numeric, 0) AS pc
    FROM sponte_parcelas WHERE situacao_parcela IN ('Quitada', 'Pendente')
    UNION ALL
    SELECT 'escola', situacao_parcela, vencimento, data_pagamento, valor_parcela, valor_pago, forma_cobranca, categoria, conta_creditar, sacado,
           coalesce(nullif(substring(bolsa_associada from '(\d+)\s*%'), '')::numeric, 0)
    FROM escola_sponte_parcelas WHERE situacao_parcela IN ('Quitada', 'Pendente')
  ), per AS MATERIALIZED (
    SELECT *, CASE WHEN cat ILIKE 'matr%' THEN 'Matrículas'
                   WHEN cat ILIKE 'mensalidade%' OR cat ILIKE 'ebas%' THEN 'Mensalidades'
                   WHEN cat ILIKE 'acordo%' THEN 'Acordos'
                   ELSE 'Outras receitas' END AS grupo
    FROM par WHERE v BETWEEN p_inicio AND p_fim
  )
  SELECT jsonb_build_object(
    'dre', coalesce((SELECT jsonb_agg(jsonb_build_object('empresa', empresa, 'mes', mes, 'grupo', grupo, 'face', face, 'desconto', desconto, 'atraso', atraso, 'recebido', rec, 'qtd', n))
        FROM (SELECT empresa, to_char(v, 'YYYY-MM') AS mes, grupo, sum(face) AS face, sum(face * pc / 100) AS desconto,
                     coalesce(sum(face * (1 - pc / 100)) FILTER (WHERE sit = 'Pendente' AND v < current_date), 0) AS atraso,
                     coalesce(sum(pago) FILTER (WHERE sit = 'Quitada'), 0) AS rec, count(*) AS n
              FROM per GROUP BY 1, 2, 3) t), '[]'::jsonb),
    'dia_conta', coalesce((SELECT jsonb_agg(jsonb_build_object('empresa', empresa, 'dia', dp, 'conta', conta, 'qtd', n, 'valor', val) ORDER BY dp DESC, val DESC)
        FROM (SELECT empresa, dp, coalesce(nullif(conta, ''), '(sem conta)') AS conta, count(*) AS n, sum(pago) AS val
              FROM par WHERE sit = 'Quitada' AND dp BETWEEN current_date - 29 AND current_date GROUP BY 1, 2, 3) t), '[]'::jsonb),
    'verificacoes', coalesce((SELECT jsonb_agg(jsonb_build_object('empresa', empresa,
          'pagas_abaixo', pagas_abaixo, 'pagas_abaixo_valor', pagas_abaixo_valor, 'pago_zero', pago_zero, 'sem_conta', sem_conta,
          'pendente_antigo', pendente_antigo, 'pendente_antigo_valor', pendente_antigo_valor, 'pagas_acima', pagas_acima, 'pendente_com_data', pendente_com_data))
        FROM (SELECT empresa,
                count(*) FILTER (WHERE sit = 'Quitada' AND dp BETWEEN p_inicio AND p_fim AND pago > 0 AND pago < face * (1 - pc / 100) - 1) AS pagas_abaixo,
                coalesce(sum(face * (1 - pc / 100) - pago) FILTER (WHERE sit = 'Quitada' AND dp BETWEEN p_inicio AND p_fim AND pago > 0 AND pago < face * (1 - pc / 100) - 1), 0) AS pagas_abaixo_valor,
                count(*) FILTER (WHERE sit = 'Quitada' AND dp BETWEEN p_inicio AND p_fim AND coalesce(pago, 0) = 0 AND pc < 100) AS pago_zero,
                count(*) FILTER (WHERE sit = 'Quitada' AND dp BETWEEN p_inicio AND p_fim AND coalesce(conta, '') = '') AS sem_conta,
                count(*) FILTER (WHERE sit = 'Pendente' AND v < current_date - 180) AS pendente_antigo,
                coalesce(sum(face) FILTER (WHERE sit = 'Pendente' AND v < current_date - 180), 0) AS pendente_antigo_valor,
                count(*) FILTER (WHERE sit = 'Quitada' AND dp BETWEEN p_inicio AND p_fim AND pago > face * (1 - pc / 100) + 1) AS pagas_acima,
                count(*) FILTER (WHERE sit = 'Pendente' AND dp IS NOT NULL) AS pendente_com_data
              FROM par GROUP BY empresa) t), '[]'::jsonb),
    'semanas', coalesce((SELECT jsonb_agg(jsonb_build_object('empresa', empresa, 'semana', sem, 'liquido', liq, 'face', fc, 'qtd', n) ORDER BY sem)
        FROM (SELECT empresa, date_trunc('week', v)::date AS sem, sum(face * (1 - pc / 100)) AS liq, sum(face) AS fc, count(*) AS n
              FROM par WHERE sit = 'Pendente' AND v >= current_date AND v < current_date + 84 GROUP BY 1, 2) t), '[]'::jsonb),
    'realizacao', coalesce((SELECT jsonb_agg(jsonb_build_object('empresa', empresa, 'q_face', q_face, 'q_pago', q_pago, 'h_pagas', h_pagas, 'h_total', h_total, 'h_pago', h_pago))
        FROM (SELECT empresa,
                coalesce(sum(face) FILTER (WHERE sit = 'Quitada' AND v BETWEEN p_inicio AND p_fim), 0) AS q_face,
                coalesce(sum(pago) FILTER (WHERE sit = 'Quitada' AND v BETWEEN p_inicio AND p_fim), 0) AS q_pago,
                coalesce(sum(face) FILTER (WHERE sit = 'Quitada' AND v BETWEEN current_date - 180 AND current_date - 1), 0) AS h_pagas,
                coalesce(sum(face) FILTER (WHERE v BETWEEN current_date - 180 AND current_date - 1), 0) AS h_total,
                coalesce(sum(pago) FILTER (WHERE sit = 'Quitada' AND v BETWEEN current_date - 180 AND current_date - 1), 0) AS h_pago
              FROM par GROUP BY empresa) t), '[]'::jsonb),
    'recebimentos', coalesce((SELECT jsonb_agg(jsonb_build_object('empresa', empresa, 'data', dp, 'sacado', sacado, 'categoria', cat, 'forma', forma, 'conta', conta, 'face', face, 'pago', pago, 'desconto', pc))
        FROM (SELECT *, row_number() OVER (PARTITION BY empresa ORDER BY dp DESC, pago DESC) AS rn
              FROM par WHERE sit = 'Quitada' AND dp BETWEEN p_inicio AND p_fim) t WHERE rn <= 100), '[]'::jsonb),
    'faixas', coalesce((SELECT jsonb_agg(jsonb_build_object('empresa', empresa, 'faixa', faixa, 'face', fc, 'liquido', liq, 'qtd', n))
        FROM (SELECT empresa, CASE WHEN current_date - v <= 30 THEN '1 a 30 dias' WHEN current_date - v <= 60 THEN '31 a 60 dias'
                                   WHEN current_date - v <= 90 THEN '61 a 90 dias' ELSE 'Mais de 90 dias' END AS faixa,
                     sum(face) AS fc, sum(face * (1 - pc / 100)) AS liq, count(*) AS n
              FROM per WHERE sit = 'Pendente' AND v < current_date GROUP BY 1, 2) t), '[]'::jsonb),
    'devedores', coalesce((SELECT jsonb_agg(jsonb_build_object('empresa', empresa, 'sacado', sacado, 'face', fc, 'qtd', n, 'atraso', atraso))
        FROM (SELECT *, row_number() OVER (PARTITION BY empresa ORDER BY fc DESC) AS rn
              FROM (SELECT empresa, coalesce(sacado, '(sem nome)') AS sacado, sum(face) AS fc, count(*) AS n, max(current_date - v) AS atraso
                    FROM per WHERE sit = 'Pendente' AND v < current_date GROUP BY 1, 2) a) t WHERE rn <= 15), '[]'::jsonb),
    'categorias', coalesce((SELECT jsonb_agg(jsonb_build_object('empresa', empresa, 'categoria', coalesce(cat, '(sem categoria)'), 'face', fc, 'pago', pg, 'qtd', n) ORDER BY fc DESC)
        FROM (SELECT empresa, cat, sum(face) AS fc, coalesce(sum(pago) FILTER (WHERE sit = 'Quitada'), 0) AS pg, count(*) AS n
              FROM per GROUP BY 1, 2) t), '[]'::jsonb)
  ) INTO r;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.financeiro_detalhe(date, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.financeiro_detalhe(date, date) TO authenticated;
