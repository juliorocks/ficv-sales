-- Mensagens rápidas (quick_replies) ganham painel de gerenciar (28-29/09), compartilhado
-- entre o chat do lead (Kanban) e os chamados. Pedido: "podendo ser cadastradas por
-- qualquer agente" — hoje só quem tem is_staff() (admin/agent) podia criar/editar/apagar;
-- quem só atende chamados (secretaria/tutor/coordenador/atendente/biblioteca) já conseguia
-- ler (policy de 25/09 trocou o SELECT pra is_ticket_staff()) mas não escrever. Alinha
-- INSERT/UPDATE/DELETE com o mesmo is_ticket_staff() (que já inclui admin/agent).
DROP POLICY IF EXISTS quick_replies_staff_write ON quick_replies;
CREATE POLICY quick_replies_staff_write ON quick_replies
  FOR INSERT TO authenticated WITH CHECK (public.is_ticket_staff());

DROP POLICY IF EXISTS quick_replies_staff_update ON quick_replies;
CREATE POLICY quick_replies_staff_update ON quick_replies
  FOR UPDATE TO authenticated USING (public.is_ticket_staff()) WITH CHECK (public.is_ticket_staff());

DROP POLICY IF EXISTS quick_replies_staff_delete ON quick_replies;
CREATE POLICY quick_replies_staff_delete ON quick_replies
  FOR DELETE TO authenticated USING (public.is_ticket_staff());
