-- ============================================================================
-- wc_find_or_create_lead: acha ou cria um lead do WideChat de forma atômica.
-- Evita a corrida de 2 webhooks simultâneos criando 2 leads pro mesmo contato
-- (advisory lock por identidade dentro da transação da função).
-- ============================================================================

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
                     data_entrada, valor_oportunidade)
  VALUES (p_name, coalesce(nullif(p_phone,''),'00000000000'), p_stage_id, p_source_id, 'Widechat',
          nullif(p_contact,''), nullif(p_session,''), 'frio', now(), 0)
  RETURNING id INTO v_id;

  RETURN QUERY SELECT v_id, true;
END;
$$;

REVOKE ALL ON FUNCTION wc_find_or_create_lead(text,text,text,text,integer,bigint) FROM public;
GRANT EXECUTE ON FUNCTION wc_find_or_create_lead(text,text,text,text,integer,bigint) TO service_role;
