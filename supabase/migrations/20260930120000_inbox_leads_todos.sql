-- Pedido explícito do usuário (30/09, reforçado): Atendimentos e Kanban têm que mostrar o
-- MESMO número por etapa, sempre — "diminui em um, diminui no outro". O inbox_leads de
-- antes só trazia lead com mensagem nos últimos 60 dias (era um INNER JOIN com a última
-- mensagem) — um Matriculado sem conversa recente, por exemplo, nunca aparecia ali, mesmo
-- contando no Kanban. Agora é LEFT JOIN: todo lead da etapa entra, com ou sem mensagem (sem
-- mensagem nenhuma = mostra "Sem mensagens ainda" no front, ordenado pelo fallback abaixo).
--
-- Contagem por etapa deixa de ter versão própria (inbox_leads_counts) — usa
-- leads_stage_counts, a MESMA function que já alimenta o selo do Kanban (commit 1306183).
-- Sendo a função idêntica, os dois números ficam estruturalmente impossíveis de divergir.
DROP FUNCTION IF EXISTS public.inbox_leads(integer, text, uuid, uuid[], boolean, integer);
DROP FUNCTION IF EXISTS public.inbox_leads_counts(text, uuid, uuid[], boolean);

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
     WHERE m.lead_id IS NOT NULL
       AND coalesce(m.message, '') !~* 'sua sess[ãa]o (ir[áa] expirar|expirou)|sess[ãa]o encerrada por inatividade'
     ORDER BY m.lead_id, m.created_at DESC
  )
  SELECT l.id, l.nome_completo, l.telefone, l.email, l.stage_id, s.name,
         l.assigned_to_id, p.full_name, l.perfil, l.widechat_contact_id,
         coalesce(last.created_at, l.stage_entry_date, l.data_entrada), last.message, last.origin, last.type, last.provider,
         coalesce(pr.pending_count, 0)
    FROM leads l
    JOIN stages s ON s.id = l.stage_id
    LEFT JOIN last ON last.lead_id = l.id
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
   ORDER BY coalesce(last.created_at, l.stage_entry_date, l.data_entrada) DESC
   LIMIT p_limit;
$$;
REVOKE EXECUTE ON FUNCTION public.inbox_leads(integer, text, uuid, uuid[], boolean, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inbox_leads(integer, text, uuid, uuid[], boolean, integer) TO authenticated;
