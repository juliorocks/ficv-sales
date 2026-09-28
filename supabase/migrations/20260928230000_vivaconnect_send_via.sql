-- ============================================================================
-- VivaConnect: "enviar automáticos por" — 28/09, pedido explícito do usuário depois de
-- não dar pra confirmar por qual caminho a Coexistência do Z-PRO estava de fato mandando
-- as respostas automáticas (WABA paga ou Baileys vinculada). Em vez de confiar no Z-PRO
-- decidir sozinho, o canal "oficial" (ex.: FICV 2 WABA, dono do lead/webhook de entrada)
-- pode apontar pra outro canal (ex.: FICV 2 - Baileys) por onde TODA resposta AUTOMÁTICA
-- (IA, Hub, 1ª mensagem, lembrete de aluno) realmente sai — a gente escolhe, com certeza.
-- Envio manual (agente pelo CRM) e templates (HSM, só a API oficial manda) não mudam.
-- ============================================================================

ALTER TABLE vivaconnect_channels
  ADD COLUMN IF NOT EXISTS send_via_channel_id bigint REFERENCES vivaconnect_channels(id) ON DELETE SET NULL;
ALTER TABLE vivaconnect_channels DROP CONSTRAINT IF EXISTS vivaconnect_channels_send_via_not_self;
ALTER TABLE vivaconnect_channels ADD CONSTRAINT vivaconnect_channels_send_via_not_self CHECK (send_via_channel_id IS NULL OR send_via_channel_id <> id);

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
    zpro_mode_seen_at,
    send_via_channel_id
   FROM vivaconnect_channels c
  WHERE is_admin() OR COALESCE(auth.role(), '') = 'service_role' OR CURRENT_USER = ANY (ARRAY['postgres'::name, 'service_role'::name]);
