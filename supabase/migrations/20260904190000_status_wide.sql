-- ============================================================================
-- status_wide: confirmação automática de que o lead chegou a conversar no
-- WideChat (WhatsApp). Antes era um campo manual (agente checava no painel
-- do Widechat e marcava "OK WIDE"/"ERRO" na edição do lead) — a coluna tinha
-- ficado de fora da rebase do schema pós-migração SurrealDB→Postgres, o que
-- quebrava silenciosamente TODO salvamento de lead pela tela de edição
-- (PGRST204: coluna não existe). Agora volta como coluna, mas setada
-- automaticamente pelo widechat-webhook (não mais editável na UI).
-- ============================================================================

ALTER TABLE leads ADD COLUMN IF NOT EXISTS status_wide text
  CHECK (status_wide IS NULL OR status_wide IN ('ok_wide', 'erro'));

-- wc_find_or_create_lead: ao CRIAR um lead novo a partir de um evento do
-- Widechat, o próprio contato via WhatsApp já é a confirmação — marca ok_wide
-- na criação (não precisa esperar o webhook rodar de novo).
CREATE OR REPLACE FUNCTION wc_find_or_create_lead(
  p_session   text,
  p_contact   text,
  p_phone     text,
  p_name      text,
  p_stage_id  integer,
  p_source_id bigint
)
RETURNS TABLE (lead_id integer, created boolean)
LANGUAGE plpgsql
AS $$
DECLARE
  v_id     integer;
  v_phone8 text := right(regexp_replace(coalesce(p_phone,''), '\D', '', 'g'), 8);
  v_lockk  text := coalesce(nullif(p_contact,''), nullif(p_session,''), nullif(v_phone8,''), 'wc-anon');
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('wc:' || v_lockk));

  SELECT id INTO v_id FROM leads
  WHERE (p_session IS NOT NULL AND widechat_session_id = p_session)
     OR (p_contact IS NOT NULL AND widechat_contact_id = p_contact)
     OR (length(v_phone8) >= 8 AND telefone LIKE '%' || v_phone8 || '%')
  ORDER BY id LIMIT 1;

  IF v_id IS NOT NULL THEN
    RETURN QUERY SELECT v_id, false;
    RETURN;
  END IF;

  INSERT INTO leads (nome_completo, telefone, stage_id, source_id, fonte_lead,
                     widechat_contact_id, widechat_session_id, temperatura,
                     data_entrada, valor_oportunidade, status_wide)
  VALUES (p_name, coalesce(nullif(p_phone,''),'00000000000'), p_stage_id, p_source_id, 'Widechat',
          nullif(p_contact,''), nullif(p_session,''), 'frio', now(), 0, 'ok_wide')
  RETURNING id INTO v_id;

  RETURN QUERY SELECT v_id, true;
END;
$$;
