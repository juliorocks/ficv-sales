-- 16/11: agente via "Entrada" e "IA Atendendo" sem selo (são filas sem dono e o filtro por atendente
-- só contava leads dele). Com atendente escolhido, essas duas etapas (ids 1 e 9) somam também os sem
-- dono, igual à lista de cards. As demais seguem só com os leads do atendente (decisão de 13/10).
CREATE OR REPLACE FUNCTION public.leads_stage_counts(
  p_assignee uuid DEFAULT NULL,
  p_agents uuid[] DEFAULT NULL,
  p_no_owner boolean DEFAULT false
) RETURNS TABLE (stage_id integer, total bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT l.stage_id, count(*)
    FROM leads l
   WHERE (SELECT public.is_staff())
     AND (p_assignee IS NULL OR l.assigned_to_id = p_assignee
          OR (l.stage_id IN (1, 9) AND l.assigned_to_id IS NULL))
     AND (p_agents IS NULL
          OR (l.assigned_to_id IS NOT NULL AND l.assigned_to_id = ANY(p_agents))
          OR (p_no_owner AND l.assigned_to_id IS NULL))
   GROUP BY l.stage_id;
$$;
