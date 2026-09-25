-- ============================================================================
-- Chaves de integração coladas pelo painel (Gestão > Integrações).
--
-- O VALOR fica criptografado no Supabase Vault (nome 'integ:<KEY>'). Só as
-- funções SECURITY DEFINER abaixo mexem nele e só a service_role (edge
-- functions) pode executá-las — o navegador NUNCA lê a chave de volta.
-- integration_status guarda só metadados (configurada?, 4 últimos caracteres,
-- resultado do último teste) pra tela.
--
-- As edge functions leem com _shared/secrets.ts: painel primeiro, depois a
-- variável de ambiente (supabase secrets) — o que já funcionava continua.
-- ============================================================================

CREATE TABLE IF NOT EXISTS integration_status (
  key               text PRIMARY KEY,          -- ex: OPENAI_API_KEY
  configured        boolean NOT NULL DEFAULT false,
  hint              text,                      -- '…a1b2'
  updated_at        timestamptz,
  updated_by        uuid REFERENCES profiles(id) ON DELETE SET NULL,
  last_test_ok      boolean,
  last_test_at      timestamptz,
  last_test_message text
);
ALTER TABLE integration_status ENABLE ROW LEVEL SECURITY;
CREATE POLICY integration_status_admin_sel ON integration_status FOR SELECT USING (public.is_admin());

CREATE OR REPLACE FUNCTION public.integ_set_secret(p_key text, p_value text, p_user uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault AS $$
DECLARE sid uuid;
BEGIN
  IF p_key !~ '^[A-Z][A-Z0-9_]{2,63}$' THEN RAISE EXCEPTION 'nome de chave inválido: %', p_key; END IF;
  IF coalesce(trim(p_value), '') = '' THEN RAISE EXCEPTION 'valor vazio'; END IF;
  SELECT id INTO sid FROM vault.secrets WHERE name = 'integ:' || p_key;
  IF sid IS NULL THEN
    PERFORM vault.create_secret(trim(p_value), 'integ:' || p_key, 'Chave colada em Gestão > Integrações');
  ELSE
    PERFORM vault.update_secret(sid, trim(p_value));
  END IF;
  INSERT INTO integration_status (key, configured, hint, updated_at, updated_by, last_test_ok, last_test_at, last_test_message)
  VALUES (p_key, true, '…' || right(trim(p_value), 4), now(), p_user, NULL, NULL, NULL)
  ON CONFLICT (key) DO UPDATE SET configured = true, hint = EXCLUDED.hint, updated_at = now(),
    updated_by = EXCLUDED.updated_by, last_test_ok = NULL, last_test_at = NULL, last_test_message = NULL;
END $$;

CREATE OR REPLACE FUNCTION public.integ_clear_secret(p_key text, p_user uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault AS $$
BEGIN
  DELETE FROM vault.secrets WHERE name = 'integ:' || p_key;
  UPDATE integration_status SET configured = false, hint = NULL, updated_at = now(), updated_by = p_user,
    last_test_ok = NULL, last_test_at = NULL, last_test_message = NULL
   WHERE key = p_key;
END $$;

CREATE OR REPLACE FUNCTION public.integ_get_secret(p_key text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, vault AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'integ:' || p_key LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.integ_set_secret(text, text, uuid)  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.integ_clear_secret(text, uuid)      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.integ_get_secret(text)              FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.integ_set_secret(text, text, uuid)  TO service_role;
GRANT  EXECUTE ON FUNCTION public.integ_clear_secret(text, uuid)      TO service_role;
GRANT  EXECUTE ON FUNCTION public.integ_get_secret(text)              TO service_role;

-- ── token dos números do VivaConnect: só escrita pelo painel ────────────────
-- admin continua cadastrando/trocando (INSERT/UPDATE), mas ninguém logado lê a
-- coluna api_token de volta; só as edge functions (service_role).
REVOKE SELECT ON vivaconnect_channels FROM anon, authenticated;
GRANT SELECT (id, name, purpose, kind, phone, api_id, zpro_whatsapp_id, active, daily_limit,
              last_sent_at, last_ok_at, last_error, last_error_at, created_at, updated_at)
  ON vivaconnect_channels TO authenticated;

-- a view precisa ler api_token (has_token) → roda com o dono, filtrando admin/serviço
DROP VIEW IF EXISTS vivaconnect_channel_health;
CREATE VIEW vivaconnect_channel_health AS
SELECT c.id, c.name, c.purpose, c.kind, c.phone, c.api_id, c.zpro_whatsapp_id, c.active, c.daily_limit,
       c.last_sent_at, c.last_ok_at, c.last_error, c.last_error_at, c.created_at,
       (SELECT count(*) FROM vivaconnect_outbox o
         WHERE o.channel_id = c.id AND o.status = 'sent' AND o.kind = 'first_message'
           AND o.sent_at >= date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'
       )::int AS first_sent_today,
       (SELECT count(*) FROM vivaconnect_outbox o
         WHERE o.channel_id = c.id AND o.status = 'failed' AND o.created_at > now() - interval '24 hours'
       )::int AS failed_24h,
       (SELECT count(*) FROM leads l WHERE l.vivaconnect_channel_id = c.id)::int AS leads_fixed,
       (c.api_token IS NOT NULL AND c.api_token <> '') AS has_token
  FROM vivaconnect_channels c
 WHERE public.is_admin() OR coalesce(auth.role(), '') = 'service_role' OR current_user IN ('postgres', 'service_role');
REVOKE ALL ON vivaconnect_channel_health FROM anon;
GRANT SELECT ON vivaconnect_channel_health TO authenticated, service_role;
