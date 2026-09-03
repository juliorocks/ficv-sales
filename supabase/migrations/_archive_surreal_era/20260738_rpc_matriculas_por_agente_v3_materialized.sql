-- ============================================================
-- V3: força MATERIALIZED nas CTEs. Sem isso, o Postgres inlina
-- "contatos" (agregação sobre messages_logs) dentro do LEFT JOIN
-- LATERAL e reexecuta a agregação inteira uma vez por candidata a
-- matrícula (~2700x), o que fazia a função nunca terminar.
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
SET search_path = public
AS $$
  WITH candidatos AS MATERIALIZED (
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
  earliest AS MATERIALIZED (
    SELECT normalize_name(aluno) AS norm_aluno, MIN(data_matricula) AS earliest_data
    FROM sponte_matriculas
    WHERE aluno IS NOT NULL
    GROUP BY normalize_name(aluno)
  ),
  contatos AS MATERIALIZED (
    SELECT
      normalize_name(regexp_replace(contact, '\s*\([^)]*\)\s*$', '')) AS norm_contact,
      agent_name,
      MIN(timestamp) AS primeiro_atendimento
    FROM messages_logs
    WHERE agent_name IS NOT NULL
      AND agent_name <> 'Desconhecido'
      AND contact IS NOT NULL
    GROUP BY norm_contact, agent_name
  ),
  classified AS MATERIALIZED (
    SELECT
      c.norm_aluno,
      c.norm_curso,
      ct.agent_name,
      ct.primeiro_atendimento,
      e.earliest_data,
      CASE
        WHEN ct.agent_name IS NULL THEN 'sem_atribuicao'
        WHEN e.earliest_data < ct.primeiro_atendimento::date THEN 'ja_existente'
        ELSE 'valido'
      END AS status
    FROM candidatos c
    LEFT JOIN earliest e ON e.norm_aluno = c.norm_aluno
    LEFT JOIN LATERAL (
      SELECT ct.agent_name, ct.primeiro_atendimento
      FROM contatos ct
      WHERE ct.norm_contact = c.norm_aluno
        AND ct.primeiro_atendimento::date <= c.data_matricula
      ORDER BY ct.primeiro_atendimento DESC
      LIMIT 1
    ) ct ON true
  ),
  validos AS MATERIALIZED (
    SELECT DISTINCT agent_name, norm_aluno, norm_curso
    FROM classified
    WHERE status = 'valido'
  ),
  por_agente AS MATERIALIZED (
    SELECT agent_name, COUNT(*) AS matriculas
    FROM validos
    GROUP BY agent_name
    ORDER BY COUNT(*) DESC
  )
  SELECT jsonb_build_object(
    'porAgente', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object('agentName', agent_name, 'matriculas', matriculas)) FROM por_agente),
      '[]'::jsonb
    ),
    'semAtribuicao', (SELECT COUNT(*) FROM classified WHERE status = 'sem_atribuicao'),
    'jaExistente', (SELECT COUNT(*) FROM classified WHERE status = 'ja_existente')
  );
$$;

GRANT EXECUTE ON FUNCTION matriculas_por_agente(date, date, text[], text, text) TO authenticated;
