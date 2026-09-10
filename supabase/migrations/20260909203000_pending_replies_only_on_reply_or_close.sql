-- ============================================================================
-- Badge "mensagem nova": só para de alertar quando
--   (a) um agente responde (origin='agent' depois da última msg do cliente), ou
--   (b) a conversa é finalizada  = lead num stage terminal
--       (Finalizado / Perdido / Matriculado — manual ou pelo webhook isConversationEnd).
-- Abrir o card NÃO zera mais (o WideChatHistory deixou de gravar seen no mount).
-- Se o cliente responde de novo depois disso, volta a alertar (msg nova > last_agent).
-- ============================================================================

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
JOIN leads l  ON l.id = m.lead_id
JOIN stages st ON st.id = l.stage_id
WHERE m.origin = 'channel'
  AND m.lead_id IS NOT NULL
  AND m.created_at > now() - interval '30 days'
  AND m.created_at > COALESCE(GREATEST(la.ts, s.seen_at), 'epoch'::timestamptz)
  AND st.name !~* '(finaliz|perdid|matricul)'
GROUP BY m.lead_id;

GRANT SELECT ON lead_pending_replies TO authenticated;
