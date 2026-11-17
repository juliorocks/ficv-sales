-- Nomes compatíveis: primeiro e último nome iguais e cada nome do meio do mais curto aparece no mais longo (ou é a inicial dele).
CREATE OR REPLACE FUNCTION public.nome_compativel(a text, b text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $$
DECLARE ta text[]; tb text[]; curto text[]; longo text[]; t text; ok boolean;
BEGIN
  ta := string_to_array(public.normalize_name(a), ' ');
  tb := string_to_array(public.normalize_name(b), ' ');
  IF coalesce(array_length(ta,1),0) < 2 OR coalesce(array_length(tb,1),0) < 2 THEN RETURN false; END IF;
  IF ta[1] <> tb[1] OR ta[array_length(ta,1)] <> tb[array_length(tb,1)] THEN RETURN false; END IF;
  IF array_length(ta,1) <= array_length(tb,1) THEN curto := ta; longo := tb; ELSE curto := tb; longo := ta; END IF;
  FOREACH t IN ARRAY curto LOOP
    IF t IN ('da','de','do','das','dos','e') THEN CONTINUE; END IF;
    SELECT EXISTS (SELECT 1 FROM unnest(longo) x WHERE x = t OR (length(t)=1 AND left(x,1)=t) OR (length(x)=1 AND left(t,1)=x)) INTO ok;
    IF NOT ok THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.atribuir_matriculas(p_desde date DEFAULT '2026-09-25'::date)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_n integer;
BEGIN
  WITH mat AS (
    SELECT sm.contrato_id, sm.aluno, sm.data_matricula, sm.nome_curso,
           public.phone_ddd8(coalesce(nullif(sm.celular,''), a.telefone)) fone,
           regexp_replace(lower(translate(sm.aluno,'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ','aaaaaeeeeiiiiooooouuuucnaaaaaeeeeiiiiooooouuuucn')),'[^a-z ]','','g') nome
      FROM sponte_matriculas sm LEFT JOIN alunos a ON a.sponte_aluno_id = sm.aluno_id
     WHERE sm.data_matricula >= p_desde AND sm.situacao_id IN (1,6)
  ), ld AS (
    SELECT l.id lead_id, public.phone_ddd8(l.telefone) fone,
           regexp_replace(lower(translate(l.nome_completo,'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ','aaaaaeeeeiiiiooooouuuucnaaaaaeeeeiiiiooooouuuucn')),'[^a-z ]','','g') nome,
           l.nome_completo nome_orig
      FROM leads l
  ), par AS (
    SELECT m.*, l.lead_id,
           CASE WHEN m.fone IS NOT NULL AND m.fone = l.fone THEN 'fone'
                WHEN m.nome = l.nome THEN 'nome' ELSE 'nome2' END via
      FROM mat m JOIN ld l ON (m.fone IS NOT NULL AND m.fone = l.fone)
        OR (array_length(string_to_array(trim(m.nome),' '),1) >= 2 AND m.nome = l.nome)
        OR (split_part(trim(m.nome),' ',1) = split_part(trim(l.nome),' ',1) AND public.nome_compativel(m.aluno, l.nome_orig))
  ), falas AS (
    SELECT p.contrato_id, p.lead_id, w.sender_name, pr.id agente_id, count(*) qtd, max(w.created_at) ultima
      FROM par p
      JOIN widechat_messages w ON w.lead_id = p.lead_id AND w.origin = 'agent' AND w.interno IS NOT TRUE
       AND w.created_at >= p.data_matricula - interval '60 days' AND w.created_at < p.data_matricula + interval '1 day'
       AND coalesce(w.message,'') !~* 'vamos (continuar|contnuar|dar continuidade)|dando continuidade ao seu atendimento|basta responder'
      JOIN profiles pr ON lower(trim(pr.full_name)) = lower(trim(w.sender_name))
     GROUP BY 1,2,3,4
  ), melhor AS (
    SELECT DISTINCT ON (contrato_id) contrato_id, lead_id, sender_name, agente_id, qtd, ultima
      FROM falas WHERE qtd >= 2 ORDER BY contrato_id, qtd DESC, ultima DESC
  )
  INSERT INTO matricula_atribuicao (contrato_id, aluno, data_matricula, nome_curso, lead_id, via, agente_nome, agente_id, n_msgs, ultima_msg, calculado_em)
  SELECT DISTINCT ON (p.contrato_id) p.contrato_id, p.aluno, p.data_matricula, p.nome_curso, b.lead_id, p.via, b.sender_name, b.agente_id, b.qtd, b.ultima, now()
    FROM par p JOIN melhor b ON b.contrato_id = p.contrato_id AND b.lead_id = p.lead_id
   ORDER BY p.contrato_id, (p.via = 'fone') DESC, (p.via = 'nome') DESC
  ON CONFLICT (contrato_id) DO UPDATE SET lead_id = EXCLUDED.lead_id, via = EXCLUDED.via, agente_nome = EXCLUDED.agente_nome,
    agente_id = EXCLUDED.agente_id, n_msgs = EXCLUDED.n_msgs, ultima_msg = EXCLUDED.ultima_msg, data_matricula = EXCLUDED.data_matricula, calculado_em = now();
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $function$;

-- Tela "Matrículas por agente": além do celular do Sponte (vazio desde ago/2026), usa o cruzamento de matricula_atribuicao.
CREATE OR REPLACE FUNCTION public.matriculas_por_agente(p_data_inicio date, p_data_fim date, p_cursos text[] DEFAULT NULL::text[], p_turma text DEFAULT NULL::text, p_situacao text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$
  WITH candidatos AS MATERIALIZED (
    SELECT sm.contrato_id, sm.aluno, sm.nome_curso, sm.data_matricula,
      normalize_name(sm.aluno) AS norm_aluno,
      normalize_name(split_part(sm.nome_curso, '(', 1)) AS norm_curso,
      CASE WHEN coalesce(nullif(sm.celular,''), a.telefone) IS NOT NULL
            AND length(regexp_replace(coalesce(nullif(sm.celular,''), a.telefone), '[^0-9]', '', 'g')) >= 8
           THEN right(regexp_replace(coalesce(nullif(sm.celular,''), a.telefone), '[^0-9]', '', 'g'), 11)
           ELSE NULL END AS aluno_phone
    FROM sponte_matriculas sm
    LEFT JOIN alunos a ON a.sponte_aluno_id = sm.aluno_id
    WHERE sm.data_matricula BETWEEN p_data_inicio AND p_data_fim
      AND sm.aluno IS NOT NULL
      AND (p_cursos IS NULL OR array_length(p_cursos, 1) IS NULL OR sm.nome_curso = ANY (p_cursos))
      AND (p_turma IS NULL OR p_turma = 'all' OR sm.nome_turma = p_turma)
      AND (p_situacao IS NULL OR p_situacao = 'all' OR sm.situacao = p_situacao)
  ),
  earliest AS MATERIALIZED (
    SELECT normalize_name(aluno) AS norm_aluno, MIN(data_matricula) AS earliest_data
    FROM sponte_matriculas WHERE aluno IS NOT NULL GROUP BY normalize_name(aluno)
  ),
  contatos AS MATERIALIZED (
    SELECT contact_phone, norm_contact, agent_name, MIN(ts) AS primeiro_atendimento
    FROM (
      SELECT right(regexp_replace(l.telefone, '[^0-9]', '', 'g'), 11) AS contact_phone,
             normalize_name(l.nome_completo) AS norm_contact, p.full_name AS agent_name, wm.created_at AS ts
      FROM widechat_messages wm
      JOIN leads l ON l.id = wm.lead_id
      JOIN profiles p ON p.id = l.assigned_to_id
      WHERE wm.origin = 'agent' AND l.telefone IS NOT NULL AND wm.created_at IS NOT NULL
        AND wm.created_at >= (p_data_inicio - INTERVAL '30 days')::timestamptz
        AND wm.created_at <= p_data_fim::timestamptz + INTERVAL '1 day'
      UNION ALL
      SELECT CASE WHEN ml.contact ~ '\(\d{8,15}\)'
             THEN right(regexp_replace(substring(ml.contact FROM '\((\d+)\)'), '[^0-9]', '', 'g'), 11) ELSE NULL END,
             normalize_name(regexp_replace(ml.contact, '\s*\([^)]*\)\s*$', '')), ml.agent_name, ml."timestamp"
      FROM messages_logs ml
      WHERE ml.agent_name IS NOT NULL AND ml.agent_name <> 'Desconhecido' AND ml.contact IS NOT NULL
        AND ml."timestamp" >= (p_data_inicio - INTERVAL '30 days')::timestamptz
        AND ml."timestamp" <= p_data_fim::timestamptz + INTERVAL '1 day'
    ) all_contacts
    GROUP BY contact_phone, norm_contact, agent_name
  ),
  classified AS MATERIALIZED (
    SELECT c.aluno, c.nome_curso, c.data_matricula, c.norm_aluno, c.norm_curso,
      e.earliest_data, best_match.agent_name, best_match.primeiro_atendimento, best_match.match_type,
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
        SELECT ma.agente_nome AS agent_name,
               (SELECT MIN(w.created_at) FROM widechat_messages w
                 WHERE w.lead_id = ma.lead_id AND w.origin = 'agent' AND w.interno IS NOT TRUE
                   AND w.created_at >= ma.data_matricula - INTERVAL '60 days') AS primeiro_atendimento,
               0 AS priority, 'atribuicao' AS match_type
        FROM matricula_atribuicao ma
        WHERE ma.contrato_id = c.contrato_id AND ma.agente_nome IS NOT NULL
        UNION ALL
        SELECT ct.agent_name, ct.primeiro_atendimento, 1, 'phone'
        FROM contatos ct
        WHERE ct.contact_phone IS NOT NULL AND c.aluno_phone IS NOT NULL
          AND ct.contact_phone = c.aluno_phone
          AND ct.primeiro_atendimento::date <= c.data_matricula
          AND c.data_matricula - ct.primeiro_atendimento::date <= 30
        UNION ALL
        SELECT ct.agent_name, ct.primeiro_atendimento, 2, 'name'
        FROM contatos ct
        WHERE ct.norm_contact = c.norm_aluno
          AND ct.primeiro_atendimento::date <= c.data_matricula
          AND c.data_matricula - ct.primeiro_atendimento::date <= 30
      ) combined
      WHERE primeiro_atendimento IS NOT NULL
      ORDER BY priority, primeiro_atendimento DESC
      LIMIT 1
    ) best_match ON true
  ),
  validos AS MATERIALIZED (
    SELECT DISTINCT ON (agent_name, norm_aluno, norm_curso)
      agent_name, norm_aluno, norm_curso, aluno, nome_curso, data_matricula, match_type
    FROM classified WHERE status = 'valido'
    ORDER BY agent_name, norm_aluno, norm_curso, data_matricula
  ),
  por_agente AS MATERIALIZED (
    SELECT agent_name, COUNT(*) AS matriculas FROM validos GROUP BY agent_name ORDER BY COUNT(*) DESC
  )
  SELECT jsonb_build_object(
    'porAgente', COALESCE((SELECT jsonb_agg(jsonb_build_object('agentName', agent_name, 'matriculas', matriculas)) FROM por_agente), '[]'::jsonb),
    'detalhes',  COALESCE((SELECT jsonb_agg(jsonb_build_object(
       'agentName', agent_name, 'aluno', aluno, 'curso', nome_curso,
       'dataMatricula', data_matricula, 'matchType', match_type)) FROM validos), '[]'::jsonb),
    'semAtribuicao', (SELECT COUNT(*) FROM classified WHERE status = 'sem_atribuicao'),
    'jaExistente',   (SELECT COUNT(*) FROM classified WHERE status = 'ja_existente')
  );
$function$;
