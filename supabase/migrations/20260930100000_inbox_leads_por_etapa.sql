-- Pedido do usuário 30/09: a visão "Atendimentos" (caixa de entrada) ganha as MESMAS abas do
-- Kanban (IA Atendendo / Entrada / Em Contato / Matriculado / Finalizado) em vez do
-- agrupamento antigo (Abertos = tudo que não é finalizado/perdido, Pendentes, Finalizados).
-- p_tab (texto fixo) vira p_stage_id (o id real da etapa, igual o Kanban já usa) — nunca mais
-- precisa reescrever esta function se uma etapa for renomeada/reordenada (só o front, que já
-- lê `stages` dinamicamente, igual o KanbanBoard).
DROP FUNCTION IF EXISTS public.inbox_leads(text, text, uuid, uuid[], boolean, integer);

CREATE OR REPLACE FUNCTION public.inbox_leads(
  p_stage_id integer,
  p_search text DEFAULT NULL,
  p_assignee uuid DEFAULT NULL,
  p_agents uuid[] DEFAULT NULL,
  p_no_owner boolean DEFAULT false,
  p_limit integer DEFAULT 200
) RETURNS TABLE (
  lead_id integer, nome text, telefone text, email text, stage_id integer, stage_name text,
  assigned_to_id uuid, atendente text, perfil text, widechat_contact_id text,
  last_at timestamptz, last_message text, last_origin text, last_type text, last_provider text,
  pending_count bigint
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH last AS (
    SELECT DISTINCT ON (m.lead_id) m.lead_id, m.created_at, m.message, m.origin, m.type, m.provider
      FROM widechat_messages m
     WHERE m.lead_id IS NOT NULL AND m.created_at > now() - interval '60 days'
       AND coalesce(m.message, '') !~* 'sua sess[ãa]o (ir[áa] expirar|expirou)|sess[ãa]o encerrada por inatividade'
     ORDER BY m.lead_id, m.created_at DESC
  )
  SELECT l.id, l.nome_completo, l.telefone, l.email, l.stage_id, s.name,
         l.assigned_to_id, p.full_name, l.perfil, l.widechat_contact_id,
         last.created_at, last.message, last.origin, last.type, last.provider,
         coalesce(pr.pending_count, 0)
    FROM last
    JOIN leads l  ON l.id = last.lead_id
    JOIN stages s ON s.id = l.stage_id
    LEFT JOIN profiles p ON p.id = l.assigned_to_id
    LEFT JOIN lead_pending_replies pr ON pr.lead_id = l.id
   WHERE (SELECT public.is_staff())
     AND l.stage_id = p_stage_id
     AND (p_search IS NULL OR p_search = ''
          OR l.nome_completo ILIKE '%' || p_search || '%'
          OR regexp_replace(coalesce(l.telefone,''), '\D', '', 'g') LIKE '%' || regexp_replace(p_search, '\D', '', 'g') || '%' AND regexp_replace(p_search, '\D', '', 'g') <> '')
     AND (p_assignee IS NULL OR l.assigned_to_id = p_assignee OR l.assigned_to_id IS NULL)
     AND (p_agents IS NULL
          OR (l.assigned_to_id IS NOT NULL AND l.assigned_to_id = ANY(p_agents))
          OR (p_no_owner AND l.assigned_to_id IS NULL))
   ORDER BY last.created_at DESC
   LIMIT p_limit;
$$;
REVOKE EXECUTE ON FUNCTION public.inbox_leads(integer, text, uuid, uuid[], boolean, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inbox_leads(integer, text, uuid, uuid[], boolean, integer) TO authenticated;

-- Contagem por etapa (pro selo numérico em cada aba, igual o Kanban) — MESMOS filtros e
-- mesmo corte de "conversa recente" (60 dias) do inbox_leads acima, senão o selo mostraria
-- um número maior do que a lista de fato traz quando a aba é aberta.
CREATE OR REPLACE FUNCTION public.inbox_leads_counts(
  p_search text DEFAULT NULL,
  p_assignee uuid DEFAULT NULL,
  p_agents uuid[] DEFAULT NULL,
  p_no_owner boolean DEFAULT false
) RETURNS TABLE (stage_id integer, total bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH last AS (
    SELECT DISTINCT ON (m.lead_id) m.lead_id, m.created_at
      FROM widechat_messages m
     WHERE m.lead_id IS NOT NULL AND m.created_at > now() - interval '60 days'
       AND coalesce(m.message, '') !~* 'sua sess[ãa]o (ir[áa] expirar|expirou)|sess[ãa]o encerrada por inatividade'
     ORDER BY m.lead_id, m.created_at DESC
  )
  SELECT l.stage_id, count(*)
    FROM last
    JOIN leads l ON l.id = last.lead_id
   WHERE (SELECT public.is_staff())
     AND (p_search IS NULL OR p_search = ''
          OR l.nome_completo ILIKE '%' || p_search || '%'
          OR regexp_replace(coalesce(l.telefone,''), '\D', '', 'g') LIKE '%' || regexp_replace(p_search, '\D', '', 'g') || '%' AND regexp_replace(p_search, '\D', '', 'g') <> '')
     AND (p_assignee IS NULL OR l.assigned_to_id = p_assignee OR l.assigned_to_id IS NULL)
     AND (p_agents IS NULL
          OR (l.assigned_to_id IS NOT NULL AND l.assigned_to_id = ANY(p_agents))
          OR (p_no_owner AND l.assigned_to_id IS NULL))
   GROUP BY l.stage_id;
$$;
REVOKE EXECUTE ON FUNCTION public.inbox_leads_counts(text, uuid, uuid[], boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inbox_leads_counts(text, uuid, uuid[], boolean) TO authenticated;
