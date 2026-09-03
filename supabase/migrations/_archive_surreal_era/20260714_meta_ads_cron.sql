-- ============================================================
-- Sincronização diária automática do Meta Ads
-- Roda todo dia às 06:00 (horário de Brasília) e ressincroniza a
-- janela rolante dos últimos 30 dias (padrão da função quando
-- start_date/end_date não são informados), já que a Meta pode
-- atualizar dados de atribuição de dias anteriores.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.schedule(
  'sync-meta-ads-daily',
  '0 9 * * *', -- 09:00 UTC = 06:00 America/Sao_Paulo
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
