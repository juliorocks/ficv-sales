-- Tracinhos de confirmação (✓ enviado / ✓✓ entregue / ✓✓ azul lido), iguais ao WhatsApp —
-- pedido do usuário 13/10, depois de ver o alarme falso "não apareceu no WhatsApp" numa
-- mensagem que na verdade já tinha sido entregue (o ack do Z-PRO só demorou mais que a
-- checagem avulsa do envio). Em vez de só checar uma vez logo depois do envio, um cron
-- confere periodicamente (vivaconnect-api action=sync_delivery_status) e grava aqui — o
-- front lê isso pra pintar os tracinhos embaixo de cada mensagem nossa.
ALTER TABLE widechat_messages
  ADD COLUMN IF NOT EXISTS delivery_status text,
  ADD COLUMN IF NOT EXISTS delivery_error text;

DO $$
BEGIN
  PERFORM cron.unschedule('vivaconnect-delivery-status') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='vivaconnect-delivery-status');
  PERFORM cron.schedule('vivaconnect-delivery-status', '* * * * *',
    $c$SELECT public.cron_call('vivaconnect-api', '{"action":"sync_delivery_status"}')$c$);
END $$;
