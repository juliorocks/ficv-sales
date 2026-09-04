-- ============================================================================
-- quick_replies: biblioteca de mensagens prontas (atalhos) pro time usar na
-- aba Conversas do lead, sem precisar digitar/copiar de outro lugar. Não
-- depende da API do WideChat — é 100% nosso.
-- ============================================================================

CREATE TABLE IF NOT EXISTS quick_replies (
  id         bigserial PRIMARY KEY,
  title      text NOT NULL,
  content    text NOT NULL,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE quick_replies ENABLE ROW LEVEL SECURITY;

CREATE POLICY quick_replies_staff_select ON quick_replies
  FOR SELECT TO authenticated USING (is_staff());
CREATE POLICY quick_replies_staff_write ON quick_replies
  FOR INSERT TO authenticated WITH CHECK (is_staff());
CREATE POLICY quick_replies_staff_update ON quick_replies
  FOR UPDATE TO authenticated USING (is_staff()) WITH CHECK (is_staff());
CREATE POLICY quick_replies_staff_delete ON quick_replies
  FOR DELETE TO authenticated USING (is_staff());
