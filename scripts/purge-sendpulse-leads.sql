-- ============================================================================
-- purge-sendpulse-leads.sql
-- Remove os ~870k contatos importados em massa do SendPulse da tabela `leads`
-- no Postgres (Supabase). Espelho do surreal/purge-sendpulse-leads.js.
--
-- NÃO é uma migration: rode manualmente no SQL Editor do Supabase (ou psql com
-- service role). Precisa de statement_timeout alto e roda em lotes.
--
-- Preserva qualquer lead com sinal de engajamento real:
--   - assigned_to_id IS NOT NULL        (atribuído a um agente)
--   - widechat_contact_id IS NOT NULL   (conversa de WhatsApp vinculada)
--   - stage_id <> 1                     (movido além de "Entrada")
--   - tem lead_history ou lead_notes
-- ============================================================================

SET statement_timeout = 0;

-- 1. Arquivo dos que serão removidos (para reverter, se necessário) ------------
CREATE TABLE IF NOT EXISTS leads_sendpulse_archive (LIKE leads INCLUDING DEFAULTS);

INSERT INTO leads_sendpulse_archive
SELECT l.*
FROM leads l
WHERE l.assigned_to_id IS NULL
  AND l.widechat_contact_id IS NULL
  AND l.stage_id = 1
  AND NOT EXISTS (SELECT 1 FROM lead_history h WHERE h.lead_id = l.id)
  AND NOT EXISTS (SELECT 1 FROM lead_notes   n WHERE n.lead_id = l.id)
ON CONFLICT DO NOTHING;

-- 2. Delete em lotes de 20k (evita lock longo e inchaço de WAL) ----------------
DO $$
DECLARE
  n integer;
BEGIN
  LOOP
    DELETE FROM leads
    WHERE id IN (
      SELECT l.id
      FROM leads l
      WHERE l.assigned_to_id IS NULL
        AND l.widechat_contact_id IS NULL
        AND l.stage_id = 1
        AND NOT EXISTS (SELECT 1 FROM lead_history h WHERE h.lead_id = l.id)
        AND NOT EXISTS (SELECT 1 FROM lead_notes   nt WHERE nt.lead_id = l.id)
      LIMIT 20000
    );
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'apagados neste lote: %', n;
    EXIT WHEN n = 0;
  END LOOP;
END $$;

-- 3. Recupera espaço e estatísticas ------------------------------------------
VACUUM (ANALYZE) leads;

-- 4. Conferência -------------------------------------------------------------
SELECT count(*) AS leads_restantes FROM leads;
SELECT count(*) AS arquivados      FROM leads_sendpulse_archive;
