-- widechat_messages.created_at não tinha default: o webhook do WideChat sempre manda a
-- data, mas as mensagens do VivaConnect entravam com NULL e o chat as ordenava como
-- 1970 (topo da conversa, "sumiam"). Default + backfill.
ALTER TABLE widechat_messages ALTER COLUMN created_at SET DEFAULT now();

UPDATE widechat_messages m
   SET created_at = coalesce(
         to_timestamp(nullif(m.raw_data->'msg'->>'messageTimestamp', '')::bigint),
         (SELECT o.sent_at FROM vivaconnect_outbox o WHERE o.id = (m.raw_data->>'outbox_id')::bigint),
         now())
 WHERE m.created_at IS NULL AND m.provider = 'vivaconnect';
