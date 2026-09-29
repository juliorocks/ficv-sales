-- Pedido do usuário 29/09: depois de esgotar as tentativas de reengajamento
-- (ai_followup_candidates/followup_max_count) e passar mais um tempo (padrão 24h) sem o
-- lead responder, encerra sozinho com a mensagem de fechamento padrão (a mesma "despedida"
-- já configurada em Gestão > VivaConnect > Finalizar — vivaconnect_settings.farewell_message_*).
ALTER TABLE ai_agent_settings
  ADD COLUMN IF NOT EXISTS followup_giveup_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS followup_giveup_hours   numeric NOT NULL DEFAULT 24;

-- candidatos a "desistir": sessão ativa, já mandou o máximo de follow-ups permitido, e já
-- passou followup_giveup_hours desde o ÚLTIMO follow-up (não desde a última msg do lead —
-- o lead nunca respondeu, então não tem "última msg do lead" recente nenhuma).
CREATE OR REPLACE FUNCTION public.ai_followup_giveup_candidates(p_giveup_hours numeric, p_max_count integer)
RETURNS TABLE (lead_id bigint, nome_completo text, telefone text, vivaconnect_channel_id bigint, vivaconnect_ticket_id text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT l.id, l.nome_completo, l.telefone, l.vivaconnect_channel_id, l.vivaconnect_ticket_id
    FROM ai_lead_sessions s
    JOIN leads l ON l.id = s.lead_id
   WHERE s.status = 'active'
     AND s.followup_count >= p_max_count
     AND s.last_followup_at IS NOT NULL
     AND s.last_followup_at < now() - (p_giveup_hours || ' hours')::interval
   LIMIT 20;
$$;
REVOKE EXECUTE ON FUNCTION public.ai_followup_giveup_candidates(numeric, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_followup_giveup_candidates(numeric, integer) TO service_role;

-- worker roda a cada 15 min, junto com o resto — public.cron_call() (x-cron-key).
DO $$
BEGIN
  PERFORM cron.unschedule('vivaconnect-ai-followup-giveup') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='vivaconnect-ai-followup-giveup');
  PERFORM cron.schedule('vivaconnect-ai-followup-giveup', '*/15 * * * *',
    $c$SELECT public.cron_call('vivaconnect-api', '{"action":"run_followup_giveups"}')$c$);
END $$;
