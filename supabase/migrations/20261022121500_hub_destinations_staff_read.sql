-- Atendentes (não só admin) precisam ver as empresas do Hub pra "Não é da Faculdade — encaminhar
-- para" no chat do lead. Antes só admin lia (hub_dest_admin), e pra agente a consulta voltava
-- vazia sem erro — a seção sumia. Leitura só; escrita continua só admin.
CREATE POLICY hub_dest_staff_select ON vivaconnect_hub_destinations
  FOR SELECT USING (is_staff());
