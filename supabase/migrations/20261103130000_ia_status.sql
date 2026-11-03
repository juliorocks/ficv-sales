-- Alerta de IA fora do ar: lê os erros recentes de OpenAI gravados pelo webhook do VivaConnect.
CREATE OR REPLACE FUNCTION public.ia_status()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object('falhando', false);
  END IF;
  SELECT count(*) AS falhas, max(created_at) AS ultima,
         (array_agg(outcome ORDER BY created_at DESC))[1] AS erro
    INTO r
    FROM public.vivaconnect_webhook_logs
   WHERE created_at > now() - interval '30 minutes'
     AND outcome LIKE 'stored:ia:erro OpenAI%';
  IF r.falhas = 0 THEN
    RETURN jsonb_build_object('falhando', false);
  END IF;
  RETURN jsonb_build_object(
    'falhando', true,
    'falhas', r.falhas,
    'ultima', r.ultima,
    'sem_credito', r.erro ILIKE '%no credits%' OR r.erro ILIKE '%insufficient_quota%',
    'erro', left(r.erro, 200)
  );
END $$;
GRANT EXECUTE ON FUNCTION public.ia_status() TO authenticated;
