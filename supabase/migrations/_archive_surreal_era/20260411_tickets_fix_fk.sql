-- Adiciona FK de atendente_id para profiles (necessário para o join via PostgREST)
-- A FK original para auth.users impede o join via API; adicionamos FK para profiles também
ALTER TABLE tickets
  ADD CONSTRAINT tickets_atendente_profile_fkey
  FOREIGN KEY (atendente_id) REFERENCES profiles(id) ON DELETE SET NULL;
