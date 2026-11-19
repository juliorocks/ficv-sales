-- Mover lead para a etapa Aluno é decisão da equipe (2026-11-19). O cron só converte para Matriculado.
DO $mig$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.sync_leads_matriculado_from_sponte'::regproc);
  d := replace(d, E'        where lt.key is not null\n', E'        where lt.key is not null\n          and lt.data_entrada::date <= sm.data_matricula -- só conversão; Aluno é manual\n');
  IF d NOT LIKE '%Aluno é manual%' THEN RAISE EXCEPTION 'trecho não encontrado'; END IF;
  EXECUTE d;
END $mig$;
