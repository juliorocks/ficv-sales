-- Avaliação de atendimento em tempo real (2026-10-22).
-- avaliacao_metodo: 'csv' (exportação do WideChat, histórico até 30/09), 'ia' (tempo real, via
-- analyze-conversation), 'heuristica' (backfill sem IA) e 'auto_invalidada' (sem conversa real).

ALTER TABLE messages_logs ADD COLUMN IF NOT EXISTS avaliacao_metodo text NOT NULL DEFAULT 'csv';

SELECT cron.unschedule('evaluate-finalized') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'evaluate-finalized');
SELECT cron.schedule('evaluate-finalized', '*/10 * * * *',
  $$SELECT public.cron_call('evaluate-conversations', '{"mode":"live"}'::jsonb)$$);
