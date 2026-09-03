-- ============================================================
-- V6: dual-source attribution
--   Fonte 1 (nova): widechat_messages (origin='agent') → leads.telefone
--   Fonte 2 (histórica): messages_logs (formato "Name (phone)")
--   Prioridade: phone match > name match
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
      sm.aluno,
      sm.nome_curso,
      sm.data_matricula,
      normalize_name(sm.aluno)                              AS norm_aluno,
      normalize_name(split_part(sm.nome_curso, '(', 1))    AS norm_curso,
      CASE
        WHEN sm.celular IS NOT NULL
          AND length(regexp_replace(sm.celular, '[^0-9]', '', 'g')) >= 8
        THEN right(regexp_replace(sm.celular, '[^0-9]', '', 'g'), 11)
        ELSE NULL
      END AS aluno_phone
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
      contact_phone,
      norm_contact,
      agent_name,
      MIN(ts) AS primeiro_atendimento
    FROM (
      -- Fonte nova: widechat_messages via leads.assigned_to_id → profiles
      -- Usa profiles.full_name para garantir que só agentes reais apareçam
      SELECT
        right(regexp_replace(l.telefone, '[^0-9]', '', 'g'), 11) AS contact_phone,
        normalize_name(l.nome_completo)                            AS norm_contact,
        p.full_name                                                AS agent_name,
        wm.created_at                                              AS ts
      FROM widechat_messages wm
      JOIN leads l ON l.id = wm.lead_id
      JOIN profiles p ON p.id = l.assigned_to_id
      WHERE wm.origin = 'agent'
        AND l.telefone IS NOT NULL
        AND wm.created_at IS NOT NULL
        AND wm.created_at >= (p_data_inicio - INTERVAL '30 days')::timestamptz
        AND wm.created_at <= p_data_fim::timestamptz + INTERVAL '1 day'

      UNION ALL

      -- Fonte histórica: messages_logs (parou em 22/07)
      SELECT
        CASE
          WHEN ml.contact ~ '\(\d{8,15}\)'
          THEN right(regexp_replace(substring(ml.contact FROM '\((\d+)\)'), '[^0-9]', '', 'g'), 11)
          ELSE NULL
        END                                                                                    AS contact_phone,
        normalize_name(regexp_replace(ml.contact, '\s*\([^)]*\)\s*$', ''))                    AS norm_contact,
        ml.agent_name,
        ml.timestamp                                                                           AS ts
      FROM messages_logs ml
      WHERE ml.agent_name IS NOT NULL
        AND ml.agent_name <> 'Desconhecido'
        AND ml.contact IS NOT NULL
        AND ml.timestamp >= (p_data_inicio - INTERVAL '30 days')::timestamptz
        AND ml.timestamp <= p_data_fim::timestamptz + INTERVAL '1 day'
    ) all_contacts
    GROUP BY contact_phone, norm_contact, agent_name
  ),
  classified AS MATERIALIZED (
    SELECT
      c.aluno,
      c.nome_curso,
      c.data_matricula,
      c.norm_aluno,
      c.norm_curso,
      e.earliest_data,
      best_match.agent_name,
      best_match.primeiro_atendimento,
      best_match.match_type,
      CASE
        WHEN best_match.agent_name IS NULL THEN 'sem_atribuicao'
        WHEN e.earliest_data < best_match.primeiro_atendimento::date THEN 'ja_existente'
        ELSE 'valido'
      END AS status
    FROM candidatos c
    LEFT JOIN earliest e ON e.norm_aluno = c.norm_aluno
    LEFT JOIN LATERAL (
      SELECT agent_name, primeiro_atendimento, match_type
      FROM (
        -- Phone match (priority 1)
        SELECT ct.agent_name, ct.primeiro_atendimento, 1 AS priority, 'phone' AS match_type
        FROM contatos ct
        WHERE ct.contact_phone IS NOT NULL
          AND c.aluno_phone IS NOT NULL
          AND ct.contact_phone = c.aluno_phone
          AND ct.primeiro_atendimento::date <= c.data_matricula
          AND c.data_matricula - ct.primeiro_atendimento::date <= 30
        UNION ALL
        -- Name match fallback (priority 2)
        SELECT ct.agent_name, ct.primeiro_atendimento, 2 AS priority, 'name' AS match_type
        FROM contatos ct
        WHERE ct.norm_contact = c.norm_aluno
          AND ct.primeiro_atendimento::date <= c.data_matricula
          AND c.data_matricula - ct.primeiro_atendimento::date <= 30
      ) combined
      ORDER BY priority, primeiro_atendimento DESC
      LIMIT 1
    ) best_match ON true
  ),
  validos AS MATERIALIZED (
    SELECT DISTINCT ON (agent_name, norm_aluno, norm_curso)
      agent_name, norm_aluno, norm_curso, aluno, nome_curso, data_matricula, match_type
    FROM classified
    WHERE status = 'valido'
    ORDER BY agent_name, norm_aluno, norm_curso, data_matricula
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
    'detalhes', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'agentName',    agent_name,
        'aluno',        aluno,
        'curso',        nome_curso,
        'dataMatricula', data_matricula,
        'matchType',    match_type
      )) FROM validos),
      '[]'::jsonb
    ),
    'semAtribuicao', (SELECT COUNT(*) FROM classified WHERE status = 'sem_atribuicao'),
    'jaExistente',  (SELECT COUNT(*) FROM classified WHERE status = 'ja_existente')
  );
$$;

GRANT EXECUTE ON FUNCTION matriculas_por_agente(date, date, text[], text, text) TO authenticated;
