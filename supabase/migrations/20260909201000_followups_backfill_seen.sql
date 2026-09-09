-- ============================================================================
-- Ajuste do badge "mensagem nova":
--  1. Backfill: marca TODA conversa existente como "vista agora" — senão o Kanban
--     acende quase todo card no primeiro load (leads antigos com dezenas de
--     mensagens do cliente que nunca foram respondidas por um canal rastreado).
--     "Mensagem NOVA" = a partir de agora.
--  2. View com guarda de 30 dias: mesmo sem linha em lead_conversation_seen
--     (lead novo), só conta mensagem do cliente recente — conversa parada há
--     meses não "renasce" no badge.
-- ============================================================================

INSERT INTO lead_conversation_seen (lead_id, seen_at)
SELECT DISTINCT lead_id, now()
FROM widechat_messages
WHERE lead_id IS NOT NULL
ON CONFLICT (lead_id) DO NOTHING;

DROP VIEW IF EXISTS lead_pending_replies;
CREATE VIEW lead_pending_replies WITH (security_invoker = on) AS
WITH last_agent AS (
  SELECT lead_id, max(created_at) AS ts
  FROM widechat_messages
  WHERE origin = 'agent'
  GROUP BY lead_id
)
SELECT m.lead_id,
       count(*)          AS pending_count,
       max(m.created_at) AS last_inbound_at
FROM widechat_messages m
LEFT JOIN last_agent la ON la.lead_id = m.lead_id
LEFT JOIN lead_conversation_seen s ON s.lead_id = m.lead_id
WHERE m.origin = 'channel'
  AND m.lead_id IS NOT NULL
  AND m.created_at > now() - interval '30 days'
  AND m.created_at > COALESCE(GREATEST(la.ts, s.seen_at), 'epoch'::timestamptz)
GROUP BY m.lead_id;

GRANT SELECT ON lead_pending_replies TO authenticated;
