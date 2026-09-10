-- ============================================================================
-- A view lead_pending_replies estava levando ~1,8s (polada a cada 45s por aba) —
-- o CTE last_agent fazia index scan por origin='agent' e ia no heap linha a linha
-- pra pegar lead_id/created_at (9k linhas, ~1,5s de I/O aleatório).
--
-- Índice composto (origin, lead_id, created_at): cobre tanto o last_agent quanto
-- o filtro principal (origin='channel' + created_at) como index-only scan.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_widechat_msg_origin_lead_created
  ON widechat_messages (origin, lead_id, created_at);

ANALYZE widechat_messages;
