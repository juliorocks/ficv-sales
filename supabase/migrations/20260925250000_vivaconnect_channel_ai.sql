-- IA por canal: o admin marca em cada número se a IA responde automaticamente.
-- Substitui a chave global vivaconnect_settings.ai_on_official (que só valia pro oficial).
ALTER TABLE vivaconnect_channels ADD COLUMN IF NOT EXISTS ai_enabled boolean NOT NULL DEFAULT false;
UPDATE vivaconnect_channels c SET ai_enabled = true
  FROM vivaconnect_settings s WHERE s.id = 1 AND s.ai_on_official AND c.purpose = 'official';
ALTER TABLE vivaconnect_settings DROP COLUMN IF EXISTS ai_on_official;
GRANT SELECT (ai_enabled) ON vivaconnect_channels TO authenticated;

CREATE OR REPLACE VIEW vivaconnect_channel_health AS
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
       (c.api_token IS NOT NULL AND c.api_token <> '') AS has_token,
       c.ai_enabled
  FROM vivaconnect_channels c
 WHERE public.is_admin() OR coalesce(auth.role(), '') = 'service_role' OR current_user IN ('postgres', 'service_role');
