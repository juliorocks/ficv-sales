-- Curso do chamado escolhido entre as MATRÍCULAS do aluno no Sponte (portal):
-- guarda o nome como está no Sponte; curso_id (catálogo do CRM) só quando casar.
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS curso_nome text;
