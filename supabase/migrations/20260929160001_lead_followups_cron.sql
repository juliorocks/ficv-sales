-- Follow-up AGENDADO por um humano (checkbox "Enviar mensagem automaticamente" no lembrete
-- "Retornar em", pedido do usuário 29/09): a cada 5 min, dispara quem já venceu.
-- public.cron_call() (x-cron-key) — mesmo padrão dos outros crons, não o header anon/Bearer.
DO $$
BEGIN
  PERFORM cron.unschedule('lead-followups-dispatch') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='lead-followups-dispatch');
  PERFORM cron.schedule('lead-followups-dispatch', '*/5 * * * *',
    $c$SELECT public.cron_call('vivaconnect-api', '{"action":"run_lead_followups"}')$c$);
END $$;
