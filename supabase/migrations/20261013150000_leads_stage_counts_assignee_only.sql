-- 13/10, pedido do usuário: ao filtrar o Kanban por UM atendente específico, o selo de
-- contagem da coluna somava leads dele + leads sem dono nenhum (mesma regra da listagem
-- de cards, pra sinalizar fila disponível) — número ficava grande (ex.: "Finalizado 1790"
-- pra uma agente com só 254 leads de verdade) e parecia que o filtro não tinha feito nada.
-- O usuário decidiu: o SELO deve mostrar só os leads do atendente escolhido, sem somar a
-- fila de sem-dono (a listagem de cards continua mostrando a fila normalmente — não mexido
-- aqui, só o COUNT). p_agents (filtro de Departamento) não muda: já tinha a lógica certa
-- (só inclui sem-dono quando o departamento pede isso explicitamente via p_no_owner).
CREATE OR REPLACE FUNCTION public.leads_stage_counts(
  p_assignee uuid DEFAULT NULL,
  p_agents uuid[] DEFAULT NULL,
  p_no_owner boolean DEFAULT false
) RETURNS TABLE (stage_id integer, total bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT l.stage_id, count(*)
    FROM leads l
   WHERE (SELECT public.is_staff())
     AND (p_assignee IS NULL OR l.assigned_to_id = p_assignee)
     AND (p_agents IS NULL
          OR (l.assigned_to_id IS NOT NULL AND l.assigned_to_id = ANY(p_agents))
          OR (p_no_owner AND l.assigned_to_id IS NULL))
   GROUP BY l.stage_id;
$$;
