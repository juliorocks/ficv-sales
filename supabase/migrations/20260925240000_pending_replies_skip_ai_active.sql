-- Badge "mensagem nova" no card: enquanto a IA está conduzindo a conversa
-- (ai_lead_sessions.status = 'active'), o lead NÃO aparece como esperando resposta —
-- senão os agentes atropelam a IA. No handoff a sessão vira 'handed_off' e o badge
-- acende com as mensagens do lead (as da IA são origin 'auto', não zeram).
DROP VIEW IF EXISTS lead_pending_replies;
CREATE VIEW lead_pending_replies WITH (security_invoker = on) AS
 WITH last_agent AS (
         SELECT widechat_messages.lead_id, max(widechat_messages.created_at) AS ts
           FROM widechat_messages
          WHERE widechat_messages.origin = 'agent'
          GROUP BY widechat_messages.lead_id
        )
 SELECT m.lead_id, count(*) AS pending_count, max(m.created_at) AS last_inbound_at
   FROM widechat_messages m
     LEFT JOIN last_agent la ON la.lead_id = m.lead_id
     LEFT JOIN lead_conversation_seen s ON s.lead_id = m.lead_id
     JOIN leads l ON l.id = m.lead_id
     JOIN stages st ON st.id = l.stage_id
  WHERE m.origin = 'channel' AND m.lead_id IS NOT NULL
    AND m.created_at > (now() - '30 days'::interval)
    AND m.created_at > COALESCE(GREATEST(la.ts, s.seen_at), '1970-01-01 00:00:00+00'::timestamptz)
    AND st.name !~* '(finaliz|perdid|matricul)'
    AND NOT EXISTS (SELECT 1 FROM ai_lead_sessions a WHERE a.lead_id = m.lead_id AND a.status = 'active')
  GROUP BY m.lead_id;
GRANT SELECT ON lead_pending_replies TO authenticated;
