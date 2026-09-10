-- ============================================================================
-- Limpeza pedida pelo usuário (2026-09-10): leads que vazaram pro funil Comercial
-- mas escolheram outra área no menu do bot ("Igreja Cidade Viva" / "Fundação
-- Cidade Viva" / "Livraria Cidade Viva" / "Sistema de ensino — Cidade Viva
-- Education") e NUNCA deram nenhum sinal comercial (faculdade/curso/matrícula/etc).
--
-- 55 leads (backup em scratchpad noncomm_leads_backup_*.json). 54 sem responsável,
-- 1 (Ana Cintra) atribuída à Karina mas era suporte a aluno ("acesso ao moodle").
--
-- Ação: move pra "Perdido" (stage 7) com motivo "Transferido de Setor" (id 7) +
-- entra na blocklist do webhook (msg futura desse telefone não vira lead de novo).
-- Reversível: é só mover de volta e apagar da blocklist.
-- ============================================================================

DO $$
DECLARE
  _ids bigint[];
BEGIN
  WITH conv AS (
    SELECT l.id lead_id, m.origin, m.message FROM leads l JOIN widechat_messages m ON m.lead_id = l.id
    UNION ALL
    SELECT l.id, r.origin, r.message FROM leads l
      JOIN widechat_raw_messages r ON r.session_id = l.widechat_session_id AND coalesce(l.widechat_session_id,'') <> ''
  ),
  pick AS (
    SELECT DISTINCT lead_id FROM conv
    WHERE origin = 'channel'
      AND trim(message) ~* '^(igreja cidade viva|funda[çc][ãa]o cidade viva|livraria cidade viva|sistema de ensino)'
  ),
  fac AS (
    SELECT DISTINCT lead_id FROM conv
    WHERE origin = 'channel'
      AND message ~* 'faculdade|ficv|gradua|vestibular|matr[íi]cul|bolsa|mensalidade|teologia|psicolog|direito|pedagog|enfermagem|administra|contab|curso|especializa|licenciatura|bacharel|ead|presencial|semin[áa]rio'
  )
  SELECT array_agg(l.id) INTO _ids
  FROM leads l JOIN stages s ON s.id = l.stage_id
  WHERE s.name !~* '(finaliz|perdid|matricul)'
    AND l.id IN (SELECT lead_id FROM pick)
    AND l.id NOT IN (SELECT lead_id FROM fac);

  IF _ids IS NULL THEN
    RAISE NOTICE 'nenhum lead para mover'; RETURN;
  END IF;
  RAISE NOTICE 'movendo % leads', array_length(_ids, 1);

  INSERT INTO widechat_blocklist_contacts (telefone, motivo)
  SELECT DISTINCT right(regexp_replace(telefone, '\D', '', 'g'), 8),
         'menu-bot: Igreja/Fundacao/Livraria/CV Education (limpeza 2026-09-10)'
  FROM leads WHERE id = ANY(_ids) AND length(regexp_replace(telefone, '\D', '', 'g')) >= 8
  ON CONFLICT (telefone) DO NOTHING;

  INSERT INTO lead_notes (lead_id, note, created_at)
  SELECT id, '🔀 Lead de outro setor (Igreja/Fundacao/Livraria/CV Education escolhido no menu do bot) — movido para Perdido / Transferido de Setor na limpeza de 2026-09-10.', now()
  FROM unnest(_ids) AS id;

  UPDATE leads
  SET stage_id = 7, stage_entry_date = now(), motivo_perda_id = 7, updated_at = now()
  WHERE id = ANY(_ids);
END $$;
