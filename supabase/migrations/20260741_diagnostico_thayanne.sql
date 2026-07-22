DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT sm.aluno, sm.nome_curso, sm.data_matricula
    FROM sponte_matriculas sm
    WHERE sm.data_matricula BETWEEN '2026-07-01' AND '2026-07-31'
      AND EXISTS (
        SELECT 1 FROM messages_logs ml
        WHERE normalize_name(regexp_replace(ml.contact, '\s*\([^)]*\)\s*$', '')) = normalize_name(sm.aluno)
          AND ml.agent_name = 'Thayanne Sales'
      )
  LOOP
    RAISE NOTICE 'matricula: aluno=% curso=% data=%', r.aluno, r.nome_curso, r.data_matricula;
  END LOOP;

  FOR r IN
    SELECT ml.contact, ml.agent_name, ml.timestamp, ml.protocol
    FROM messages_logs ml
    WHERE ml.agent_name = 'Thayanne Sales'
    ORDER BY ml.timestamp DESC
    LIMIT 5
  LOOP
    RAISE NOTICE 'msg_log recente: contact=% agent=% ts=% protocol=%', r.contact, r.agent_name, r.timestamp, r.protocol;
  END LOOP;
END $$;
