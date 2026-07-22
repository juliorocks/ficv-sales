-- ============================================================
-- Cruzamento leads x matrículas por agente, feito no banco (a
-- tabela leads tem ~700 mil linhas — inviável trazer pro browser).
-- Regra: só conta pro agente se a pessoa não tinha nenhuma
-- matrícula (em qualquer curso) antes da entrada do lead no funil.
-- Conta no máximo 1 matrícula por pessoa por curso por agente.
-- ============================================================

CREATE OR REPLACE FUNCTION matriculas_por_agente(
  p_data_inicio date,
  p_data_fim date,
  p_cursos text[] DEFAULT NULL,
  p_turma text DEFAULT NULL,
  p_situacao text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  WITH candidatos AS (
    SELECT
      sm.data_matricula,
      normalize_name(sm.aluno) AS norm_aluno,
      normalize_name(split_part(sm.nome_curso, '(', 1)) AS norm_curso
    FROM sponte_matriculas sm
    WHERE sm.data_matricula BETWEEN p_data_inicio AND p_data_fim
      AND sm.aluno IS NOT NULL
      AND (p_cursos IS NULL OR array_length(p_cursos, 1) IS NULL OR sm.nome_curso = ANY (p_cursos))
      AND (p_turma IS NULL OR p_turma = 'all' OR sm.nome_turma = p_turma)
      AND (p_situacao IS NULL OR p_situacao = 'all' OR sm.situacao = p_situacao)
  ),
  earliest AS (
    SELECT normalize_name(aluno) AS norm_aluno, MIN(data_matricula) AS earliest_data
    FROM sponte_matriculas
    WHERE aluno IS NOT NULL
    GROUP BY normalize_name(aluno)
  ),
  classified AS (
    SELECT
      c.norm_aluno,
      c.norm_curso,
      lp.assigned_to_id,
      lp.data_entrada,
      e.earliest_data,
      CASE
        WHEN lp.assigned_to_id IS NULL THEN 'sem_atribuicao'
        WHEN e.earliest_data < lp.data_entrada::date THEN 'ja_existente'
        ELSE 'valido'
      END AS status
    FROM candidatos c
    LEFT JOIN earliest e ON e.norm_aluno = c.norm_aluno
    LEFT JOIN LATERAL (
      SELECT l.assigned_to_id, l.data_entrada
      FROM leads l
      WHERE normalize_name(l.nome_completo) = c.norm_aluno
        AND l.assigned_to_id IS NOT NULL
        AND l.data_entrada::date <= c.data_matricula
      ORDER BY l.data_entrada DESC
      LIMIT 1
    ) lp ON true
  ),
  validos AS (
    SELECT DISTINCT assigned_to_id, norm_aluno, norm_curso
    FROM classified
    WHERE status = 'valido'
  ),
  por_agente AS (
    SELECT p.id AS agent_id, p.full_name AS agent_name, COUNT(*) AS matriculas
    FROM validos v
    JOIN profiles p ON p.id = v.assigned_to_id
    GROUP BY p.id, p.full_name
    ORDER BY COUNT(*) DESC
  )
  SELECT jsonb_build_object(
    'porAgente', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object('agentId', agent_id, 'agentName', agent_name, 'matriculas', matriculas))
       FROM por_agente),
      '[]'::jsonb
    ),
    'semAtribuicao', (SELECT COUNT(*) FROM classified WHERE status = 'sem_atribuicao'),
    'jaExistente', (SELECT COUNT(*) FROM classified WHERE status = 'ja_existente')
  );
$$;

GRANT EXECUTE ON FUNCTION matriculas_por_agente(date, date, text[], text, text) TO authenticated;
