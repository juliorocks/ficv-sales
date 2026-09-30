-- Achado ao vivo (30/09, print do usuário): o selo "Finalizado 300" no Kanban não é o total
-- de verdade — é o limite de busca (300 linhas pras etapas fechadas, por performance,
-- KanbanBoard.tsx) reaparecendo como se fosse a contagem. Total real: 2131. O selo usa
-- `sortedLeads.length` (tamanho do que foi BUSCADO, não um COUNT de verdade) — certo
-- enquanto a etapa tem menos leads que o limite (por isso Entrada/Em Contato/Matriculado
-- batiam certinho), errado assim que passa.
--
-- Conta de verdade por etapa, com os MESMOS filtros de atendente/departamento do quadro
-- (mesma lógica de leads.assigned_to_id de inbox_leads_counts) — sem o corte de 300/1000
-- linhas, que continua existindo só pra não desenhar milhares de cards de uma vez.
CREATE OR REPLACE FUNCTION public.leads_stage_counts(
  p_assignee uuid DEFAULT NULL,
  p_agents uuid[] DEFAULT NULL,
  p_no_owner boolean DEFAULT false
) RETURNS TABLE (stage_id integer, total bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT l.stage_id, count(*)
    FROM leads l
   WHERE (SELECT public.is_staff())
     AND (p_assignee IS NULL OR l.assigned_to_id = p_assignee OR l.assigned_to_id IS NULL)
     AND (p_agents IS NULL
          OR (l.assigned_to_id IS NOT NULL AND l.assigned_to_id = ANY(p_agents))
          OR (p_no_owner AND l.assigned_to_id IS NULL))
   GROUP BY l.stage_id;
$$;
REVOKE EXECUTE ON FUNCTION public.leads_stage_counts(uuid, uuid[], boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leads_stage_counts(uuid, uuid[], boolean) TO authenticated;
