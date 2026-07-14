-- ============================================================
-- Ajusta a sincronização automática do Meta Ads para rodar 4x/dia
-- e adiciona o Sponte à mesma rotina automática (antes só era
-- sincronizado manualmente pelo botão "Sincronizar").
-- Horários: 08:00, 13:00, 17:00, 21:00 (America/Sao_Paulo, UTC-3)
-- ============================================================

-- Remove o job antigo de 1x/dia do Meta Ads (idempotente)
DO $$
BEGIN
  PERFORM cron.unschedule('sync-meta-ads-daily');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'sync-meta-ads-4x-daily',
  '0 11,16,20,0 * * *', -- 08h,13h,17h,21h America/Sao_Paulo
  $$
  SELECT net.http_post(
    url := 'https://znypfroagfwohqeyxyqv.supabase.co/functions/v1/sync-meta-ads',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpueXBmcm9hZ2Z3b2hxZXl4eXF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyMDA5MjksImV4cCI6MjA4Nzc3NjkyOX0.I8F4UA8AmcELpBBlcVoeb0218LfsLm5i-Fx8FzSb-Rw'
    ),
    body := jsonb_build_object('mode', 'full')
  );
  $$
);

SELECT cron.schedule(
  'sync-sponte-4x-daily',
  '0 11,16,20,0 * * *', -- 08h,13h,17h,21h America/Sao_Paulo
  $$
  SELECT net.http_post(
    url := 'https://znypfroagfwohqeyxyqv.supabase.co/functions/v1/sync-sponte',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpueXBmcm9hZ2Z3b2hxZXl4eXF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyMDA5MjksImV4cCI6MjA4Nzc3NjkyOX0.I8F4UA8AmcELpBBlcVoeb0218LfsLm5i-Fx8FzSb-Rw'
    ),
    body := jsonb_build_object('mode', 'full')
  );
  $$
);
