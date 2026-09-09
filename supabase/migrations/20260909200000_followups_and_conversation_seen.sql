-- ============================================================================
-- Follow-ups / Tarefas + "conversa vista" + view de mensagens sem resposta
--
--  1. lead_followups        — lembrete "retornar ao cliente em X" (ou tarefa solta)
--  2. lead_conversation_seen — marca (compartilhada) de quando alguém abriu a aba
--                              Conversas de um lead; zera o badge de "msg nova"
--  3. lead_pending_replies   — view: quantas mensagens do CLIENTE ainda não foram
--                              respondidas, por lead (alimenta o badge no card)
--
-- Tudo é usado só pelo front via Supabase (igual quick_replies) — sem Edge Function
-- e sem espelhamento no SurrealDB.
-- ============================================================================

-- ── 1. lead_followups ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lead_followups (
  id           bigserial PRIMARY KEY,
  lead_id      integer REFERENCES leads(id) ON DELETE CASCADE,   -- NULL = tarefa solta
  title        text,                         -- rótulo curto (usado em tarefas sem lead)
  note         text,                         -- observações do agente
  due_at       timestamptz NOT NULL,         -- data/hora do retorno
  status       text NOT NULL DEFAULT 'pending',   -- pending | done | cancelled
  assigned_to  uuid REFERENCES profiles(id) ON DELETE SET NULL,  -- quem recebe o alerta
  created_by   uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  completed_by uuid REFERENCES profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_lead_followups_assignee ON lead_followups (assigned_to, status, due_at);
CREATE INDEX IF NOT EXISTS idx_lead_followups_lead     ON lead_followups (lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_followups_due      ON lead_followups (status, due_at);

ALTER TABLE lead_followups ENABLE ROW LEVEL SECURITY;

CREATE POLICY lead_followups_staff_select ON lead_followups
  FOR SELECT TO authenticated USING (public.is_staff());
CREATE POLICY lead_followups_staff_insert ON lead_followups
  FOR INSERT TO authenticated WITH CHECK (public.is_staff());
CREATE POLICY lead_followups_staff_update ON lead_followups
  FOR UPDATE TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());
CREATE POLICY lead_followups_staff_delete ON lead_followups
  FOR DELETE TO authenticated USING (public.is_staff());

-- ── 2. lead_conversation_seen ───────────────────────────────────────────────
-- Tabela separada (não coluna em leads) DE PROPÓSITO: gravar aqui não dispara o
-- realtime de `leads` do KanbanBoard nem força refetch dos 500 leads.
CREATE TABLE IF NOT EXISTS lead_conversation_seen (
  lead_id integer PRIMARY KEY REFERENCES leads(id) ON DELETE CASCADE,
  seen_at timestamptz NOT NULL DEFAULT now(),
  seen_by uuid REFERENCES profiles(id) ON DELETE SET NULL
);

ALTER TABLE lead_conversation_seen ENABLE ROW LEVEL SECURITY;

CREATE POLICY lead_conversation_seen_staff_select ON lead_conversation_seen
  FOR SELECT TO authenticated USING (public.is_staff());
CREATE POLICY lead_conversation_seen_staff_insert ON lead_conversation_seen
  FOR INSERT TO authenticated WITH CHECK (public.is_staff());
CREATE POLICY lead_conversation_seen_staff_update ON lead_conversation_seen
  FOR UPDATE TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

-- ── 3. view lead_pending_replies ───────────────────────────────────────────
-- Conta as mensagens origin='channel' (cliente) posteriores ao MAIOR entre:
--   - a última resposta de agente (origin='agent')
--   - a última vez que alguém abriu a aba Conversas (lead_conversation_seen.seen_at)
-- security_invoker => vale a policy widechat_messages_sel (is_staff).
DROP VIEW IF EXISTS lead_pending_replies;
CREATE VIEW lead_pending_replies WITH (security_invoker = on) AS
WITH last_agent AS (
  SELECT lead_id, max(created_at) AS ts
  FROM widechat_messages
  WHERE origin = 'agent'
  GROUP BY lead_id
)
SELECT m.lead_id,
       count(*)          AS pending_count,
       max(m.created_at) AS last_inbound_at
FROM widechat_messages m
LEFT JOIN last_agent la ON la.lead_id = m.lead_id
LEFT JOIN lead_conversation_seen s ON s.lead_id = m.lead_id
WHERE m.origin = 'channel'
  AND m.lead_id IS NOT NULL
  AND m.created_at > COALESCE(GREATEST(la.ts, s.seen_at), 'epoch'::timestamptz)
GROUP BY m.lead_id;

GRANT SELECT ON lead_pending_replies TO authenticated;
