-- Follow-up automático da IA (29/09, pedido do usuário): se o lead fica um tempo sem
-- responder depois da IA falar algo, ela manda UMA mensagem de reengajamento, escrita na
-- hora com base no histórico da conversa (não é um texto fixo — "com base no histórico,
-- nas últimas interações"). Conservador de propósito: só dentro da janela de horário já
-- usada pro resto (send_window_start/end), máximo N vezes por "silêncio" (configurável,
-- padrão 1), nunca peraltece — se o lead responder, followup_count zera sozinho.

ALTER TABLE ai_agent_settings
  ADD COLUMN IF NOT EXISTS followup_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS followup_after_hours numeric NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS followup_max_count integer NOT NULL DEFAULT 1;

ALTER TABLE ai_lead_sessions
  ADD COLUMN IF NOT EXISTS followup_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_followup_at timestamptz;

-- candidatos: sessão ativa, ÚLTIMA mensagem da conversa é NOSSA (não do lead — ele que
-- ficou quieto), já passou followup_after_hours desde essa última mensagem, ainda não
-- bateu o máximo de tentativas, e (se já mandou 1) já passou followup_after_hours de novo
-- desde o último follow-up. SECURITY DEFINER pra rodar sem RLS (chamado pelo cron/edge
-- function com service role); ninguém além do service_role executa.
CREATE OR REPLACE FUNCTION public.ai_followup_candidates(p_after_hours numeric, p_max_count integer)
RETURNS TABLE (lead_id bigint, nome_completo text, telefone text, vivaconnect_channel_id bigint, followup_count integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH last_msg AS (
    SELECT DISTINCT ON (lead_id) lead_id, origin, created_at
    FROM widechat_messages
    WHERE provider = 'vivaconnect'
    ORDER BY lead_id, created_at DESC
  )
  SELECT l.id, l.nome_completo, l.telefone, l.vivaconnect_channel_id, s.followup_count
    FROM ai_lead_sessions s
    JOIN leads l ON l.id = s.lead_id
    JOIN last_msg lm ON lm.lead_id = l.id
   WHERE s.status = 'active'
     AND lm.origin <> 'channel'
     AND lm.created_at < now() - (p_after_hours || ' hours')::interval
     AND s.followup_count < p_max_count
     AND (s.last_followup_at IS NULL OR s.last_followup_at < now() - (p_after_hours || ' hours')::interval)
   LIMIT 20;
$$;
REVOKE EXECUTE ON FUNCTION public.ai_followup_candidates(numeric, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_followup_candidates(numeric, integer) TO service_role;

-- worker roda a cada 15 min — public.cron_call() (x-cron-key), mesmo padrão já usado pro
-- resto dos crons (não o header anon/Bearer manual, que ficou pra trás em 25-26/09).
DO $$
BEGIN
  PERFORM cron.unschedule('vivaconnect-ai-followups') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='vivaconnect-ai-followups');
  PERFORM cron.schedule('vivaconnect-ai-followups', '*/15 * * * *',
    $c$SELECT public.cron_call('vivaconnect-api', '{"action":"run_followups"}')$c$);
END $$;
