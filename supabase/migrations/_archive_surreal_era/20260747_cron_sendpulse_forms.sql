-- ============================================================
-- Polling dos formulários de inscrição do SendPulse a cada 3 min.
-- Chama a Edge Function sync-sendpulse-forms, que lê a allowlist
-- em sendpulse_forms (SurrealDB) e cria os leads novos no Kanban.
-- ============================================================

DO $$
BEGIN
  PERFORM cron.unschedule('sync-sendpulse-forms');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'sync-sendpulse-forms',
  '*/3 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://znypfroagfwohqeyxyqv.supabase.co/functions/v1/sync-sendpulse-forms',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpueXBmcm9hZ2Z3b2hxZXl4eXF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyMDA5MjksImV4cCI6MjA4Nzc3NjkyOX0.I8F4UA8AmcELpBBlcVoeb0218LfsLm5i-Fx8FzSb-Rw'
    ),
    body := jsonb_build_object('trigger', 'cron')
  );
  $$
);
