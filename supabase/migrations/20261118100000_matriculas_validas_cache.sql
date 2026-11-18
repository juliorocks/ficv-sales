-- Cache das matrículas válidas por agente (resultado de matriculas_por_agente de 2026-01-01 até hoje).
-- A RPC leva ~13 s (CPU) e o papel authenticated corta em 8 s; o cartão "Média de Conversão" lê desta tabela.
CREATE TABLE IF NOT EXISTS public.matriculas_validas_cache (
  agente text NOT NULL,
  aluno text NOT NULL,
  curso text,
  data_matricula date NOT NULL,
  match_type text,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mvc_data ON public.matriculas_validas_cache (data_matricula);
ALTER TABLE public.matriculas_validas_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY mvc_sel ON public.matriculas_validas_cache FOR SELECT USING (public.is_staff());

CREATE OR REPLACE FUNCTION public.refresh_matriculas_validas() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r jsonb; v_n integer;
BEGIN
  r := public.matriculas_por_agente('2026-01-01', current_date, NULL, NULL, NULL);
  DELETE FROM public.matriculas_validas_cache;
  INSERT INTO public.matriculas_validas_cache (agente, aluno, curso, data_matricula, match_type)
  SELECT d->>'agentName', d->>'aluno', d->>'curso', (d->>'dataMatricula')::date, d->>'matchType'
    FROM jsonb_array_elements(r->'detalhes') d;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.refresh_matriculas_validas() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.matriculas_validas_resumo(p_inicio date, p_fim date, p_cursos text[] DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE WHEN NOT public.is_staff() THEN '{"porAgente":[]}'::jsonb ELSE
    jsonb_build_object('porAgente', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('agentName', agente, 'matriculas', n) ORDER BY n DESC)
        FROM (SELECT agente, count(*) n FROM public.matriculas_validas_cache
               WHERE data_matricula BETWEEN p_inicio AND p_fim
                 AND (p_cursos IS NULL OR array_length(p_cursos,1) IS NULL OR curso = ANY (p_cursos))
               GROUP BY agente) t), '[]'::jsonb)) END;
$$;
GRANT EXECUTE ON FUNCTION public.matriculas_validas_resumo(date, date, text[]) TO authenticated;

SELECT cron.schedule('matriculas-validas-cache', '25 * * * *', $$select public.refresh_matriculas_validas()$$);
SELECT public.refresh_matriculas_validas();
