-- Celular do Sponte sem DDD (8 ou 9 dígitos, ex.: 981483746) nunca casava por telefone: aluno ativo pedindo suporte
-- ficava na Entrada (2026-11-25, caso Mayckow; 240 matrículas ativas nessa situação). Sem DDD, só dá para comparar os
-- 8 últimos dígitos; isso só vale para o celular do Sponte SEM DDD (os com DDD seguem pela chave DDD+8).
CREATE OR REPLACE FUNCTION public.phone_sem_ddd8(p text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN length(d) IN (8, 9) THEN right(d, 8) END
  FROM (SELECT regexp_replace(coalesce(p, ''), '\D', '', 'g') AS d) x;
$$;

CREATE OR REPLACE FUNCTION public.match_aluno_by_phone(p_phone text)
RETURNS TABLE(aluno text, nome_curso text)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH d AS (SELECT public.phone_ddd8(p_phone) AS key, right(regexp_replace(coalesce(p_phone,''),'\D','','g'), 8) AS fim)
  SELECT sm.aluno, sm.nome_curso
    FROM sponte_matriculas sm, d
   WHERE d.key IS NOT NULL
     AND (public.phone_ddd8(sm.celular) = d.key OR public.phone_sem_ddd8(sm.celular) = d.fim)
   ORDER BY sm.data_matricula DESC NULLS LAST
   LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.match_aluno_by_phone(text) TO service_role, authenticated;

CREATE OR REPLACE FUNCTION public.match_aluno_ativo_by_phone(p_phone text) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH d AS (SELECT public.phone_ddd8(p_phone) AS key, right(regexp_replace(coalesce(p_phone,''),'\D','','g'), 8) AS fim)
  SELECT EXISTS (
    SELECT 1 FROM sponte_matriculas sm, d
     WHERE d.key IS NOT NULL AND sm.situacao_id IN (1, 6)
       AND (public.phone_ddd8(sm.celular) = d.key OR public.phone_sem_ddd8(sm.celular) = d.fim));
$$;
GRANT EXECUTE ON FUNCTION public.match_aluno_ativo_by_phone(text) TO service_role;
