-- ============================================================================
-- leads.perfil: distingue lead de venda ('lead'/null) de aluno matriculado ('aluno').
-- Preenchido pelos webhooks quando o telefone casa com uma matrícula do Sponte.
-- ============================================================================

ALTER TABLE leads ADD COLUMN IF NOT EXISTS perfil text;

-- índice pelos últimos 8 dígitos do celular (pra o match ser O(1))
CREATE INDEX IF NOT EXISTS idx_sponte_mat_fone8
  ON sponte_matriculas (right(regexp_replace(coalesce(celular,''), '\D', '', 'g'), 8))
  WHERE celular IS NOT NULL;

-- match: telefone (qualquer formato) -> matrícula mais recente do aluno
CREATE OR REPLACE FUNCTION match_aluno_by_phone(p_phone text)
RETURNS TABLE(aluno text, nome_curso text)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  WITH d AS (SELECT right(regexp_replace(coalesce(p_phone,''), '\D', '', 'g'), 8) AS f8)
  SELECT sm.aluno, sm.nome_curso
  FROM sponte_matriculas sm, d
  WHERE length(d.f8) = 8
    AND right(regexp_replace(coalesce(sm.celular,''), '\D', '', 'g'), 8) = d.f8
  ORDER BY sm.data_matricula DESC NULLS LAST
  LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION match_aluno_by_phone(text) TO service_role, authenticated;

-- backfill: leads existentes cujo telefone casa com matrícula
UPDATE leads l SET perfil = 'aluno'
FROM sponte_matriculas sm
WHERE l.perfil IS NULL
  AND length(right(regexp_replace(coalesce(l.telefone,''), '\D', '', 'g'), 8)) = 8
  AND right(regexp_replace(coalesce(l.telefone,''), '\D', '', 'g'), 8)
    = right(regexp_replace(coalesce(sm.celular,''), '\D', '', 'g'), 8);
