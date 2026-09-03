-- Adiciona curso_id à tabela tickets (FK para courses)
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS curso_id INT REFERENCES courses(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tickets_curso ON tickets(curso_id);
