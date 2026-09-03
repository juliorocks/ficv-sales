-- ============================================================================
-- pg_cron: poller dos formulários SendPulse a cada 3 min.
-- Chama a edge function sync-sendpulse-forms (verify_jwt = false).
-- ============================================================================

DO $$ BEGIN PERFORM cron.unschedule('sync-sendpulse-forms'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'sync-sendpulse-forms',
  '*/3 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://jsswkmybkgoxpncnxgdd.supabase.co/functions/v1/sync-sendpulse-forms',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impzc3drbXlia2dveHBuY254Z2RkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg0NDE2NDIsImV4cCI6MjEwNDAxNzY0Mn0.QeFd3l_pyNeoN5lVUy1d1Vo47KsbQ4vWaNXD_f2js9s'
    ),
    body := jsonb_build_object('trigger', 'cron')
  );
  $$
);
