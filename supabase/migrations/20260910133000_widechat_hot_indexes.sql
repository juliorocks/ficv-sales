-- ============================================================================
-- "App mais lento que o Free": o widechat-webhook roda em TODA mensagem do
-- WhatsApp e fazia SEQ SCAN em tabelas de 55-63k linhas — saturava a instância
-- (compute pequena) e deixava tudo lento, inclusive o Kanban.
--
-- pg_stat_statements (antes):
--   SELECT id FROM widechat_messages WHERE message_id = $1   → 1583ms x 3897 calls
--   SELECT message,origin FROM widechat_raw_messages WHERE session_id = $1 → 415ms x 8387
--   DELETE FROM widechat_messages WHERE session_id = $1      → seq scan
-- Nenhuma dessas colunas tinha índice.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_widechat_msg_message_id
  ON widechat_messages (message_id);

CREATE INDEX IF NOT EXISTS idx_widechat_msg_session
  ON widechat_messages (session_id);

CREATE INDEX IF NOT EXISTS idx_widechat_raw_session_created
  ON widechat_raw_messages (session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_widechat_raw_message_id
  ON widechat_raw_messages (message_id);

ANALYZE widechat_messages;
ANALYZE widechat_raw_messages;
