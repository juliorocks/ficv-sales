-- Visão "Atendimentos" do Funil de Leads (caixa de entrada estilo WhatsApp):
-- uma linha por lead com conversa recente — última mensagem, se o cliente está
-- esperando resposta (lead_pending_replies) e a etapa. SECURITY DEFINER com a MESMA regra
-- da RLS de leads/widechat_messages (is_staff(), sem restrição por pessoa) checada UMA vez
-- por consulta — com INVOKER a RLS rodava is_staff() por mensagem (5,5 s a frio).
--
--   p_tab: 'abertos' (etapas ativas) | 'pendentes' (cliente esperando) | 'finalizados'
--   p_assignee: só leads desse atendente (+ sem atendente, como no quadro); null = todos
--   p_agents:   filtro de departamento (ids dos atendentes; '__unassigned__' não se aplica aqui)
CREATE INDEX IF NOT EXISTS idx_widechat_msg_lead_created ON widechat_messages (lead_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.inbox_leads(
  p_tab text DEFAULT 'abertos',
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
       -- avisos do WideChat que o chat também esconde não viram "última mensagem"
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
     AND CASE p_tab
           WHEN 'pendentes'   THEN coalesce(pr.pending_count, 0) > 0
           WHEN 'finalizados' THEN s.name ~* 'finaliz|perdid'
           ELSE s.name !~* 'finaliz|perdid'
         END
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
REVOKE EXECUTE ON FUNCTION public.inbox_leads(text, text, uuid, uuid[], boolean, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inbox_leads(text, text, uuid, uuid[], boolean, integer) TO authenticated;
