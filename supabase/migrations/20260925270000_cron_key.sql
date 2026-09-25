-- Os crons chamavam as edge functions com a chave ANON no header (copiada do cron do
-- SendPulse, cuja function não exige auth) → vivaconnect-api/ticket-emails recusavam
-- (401/403). Em vez de pôr a service_role no texto do cron, cada chamada leva uma
-- chave interna só de cron (x-cron-key), lida desta tabela NA HORA da execução — o
-- valor não aparece em cron.job. Tabela sem policy: só postgres/service_role leem.
CREATE TABLE IF NOT EXISTS app_internal (key text PRIMARY KEY, value text NOT NULL);
ALTER TABLE app_internal ENABLE ROW LEVEL SECURITY;
INSERT INTO app_internal (key, value) VALUES ('cron_key', encode(extensions.gen_random_bytes(24), 'hex'))
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.cron_call(fn text, body jsonb DEFAULT '{}'::jsonb)
RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path = public, extensions AS $$
  SELECT net.http_post(
    url := 'https://jsswkmybkgoxpncnxgdd.supabase.co/functions/v1/' || fn,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      -- anon só pra passar pelo gateway (verify_jwt); quem autoriza é o x-cron-key
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impzc3drbXlia2dveHBuY254Z2RkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg0NDE2NDIsImV4cCI6MjEwNDAxNzY0Mn0.QeFd3l_pyNeoN5lVUy1d1Vo47KsbQ4vWaNXD_f2js9s',
      'x-cron-key', (SELECT value FROM app_internal WHERE key = 'cron_key')),
    body := body, timeout_milliseconds := 55000);
$$;
REVOKE EXECUTE ON FUNCTION public.cron_call(text, jsonb) FROM PUBLIC, anon, authenticated;

SELECT cron.unschedule('vivaconnect-process-outbox') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'vivaconnect-process-outbox');
SELECT cron.unschedule('ticket-emails') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ticket-emails');
SELECT cron.schedule('vivaconnect-process-outbox', '* * * * *', $$SELECT public.cron_call('vivaconnect-api', '{"action":"process_outbox"}')$$);
SELECT cron.schedule('ticket-emails', '* * * * *', $$SELECT public.cron_call('ticket-emails')$$);
