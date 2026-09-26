-- Modo do número no Z-PRO, lido de cada webhook (ticket.whatsapp.type / hybridMode).
-- Regra (26/09): resposta AUTOMÁTICA (IA, Hub, link do portal) pelo número oficial só sai
-- com o Híbrido ativo — nunca pela API paga da Meta (vivaconnect-api sendRow).
ALTER TABLE vivaconnect_channels
  ADD COLUMN IF NOT EXISTS zpro_type text,
  ADD COLUMN IF NOT EXISTS zpro_hybrid_mode text,
  ADD COLUMN IF NOT EXISTS zpro_mode_seen_at timestamptz;

CREATE OR REPLACE VIEW vivaconnect_channel_health AS
 SELECT id, name, purpose, kind, phone, api_id, zpro_whatsapp_id, active, daily_limit, last_sent_at, last_ok_at, last_error, last_error_at, created_at,
    (( SELECT count(*) FROM vivaconnect_outbox o
          WHERE o.channel_id = c.id AND o.status = 'sent' AND o.kind = 'first_message'
            AND o.sent_at >= (date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo')))::integer AS first_sent_today,
    (( SELECT count(*) FROM vivaconnect_outbox o
          WHERE o.channel_id = c.id AND o.status = 'failed' AND o.created_at > now() - interval '24 hours'))::integer AS failed_24h,
    (( SELECT count(*) FROM leads l WHERE l.vivaconnect_channel_id = c.id))::integer AS leads_fixed,
    (api_token IS NOT NULL AND api_token <> '') AS has_token,
    ai_enabled,
    hub_enabled,
    zpro_type,
    zpro_hybrid_mode,
    zpro_mode_seen_at
   FROM vivaconnect_channels c
  WHERE is_admin() OR COALESCE(auth.role(), '') = 'service_role' OR CURRENT_USER = ANY (ARRAY['postgres'::name, 'service_role'::name]);
