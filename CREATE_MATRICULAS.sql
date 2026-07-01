-- ============================================================
-- TABELA: matriculas
-- Alunos matriculados na FICV, usados para calcular conversão
-- CPF como chave única (um aluno conta como UMA conversão)
-- ============================================================

CREATE TABLE IF NOT EXISTS matriculas (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  cpf          TEXT NOT NULL,
  nome         TEXT NOT NULL,
  email        TEXT,
  telefone     TEXT,
  curso        TEXT,
  turma        TEXT,
  data_matricula DATE,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE(cpf)
);

-- Índice para busca por data (usada no cálculo de conversão)
CREATE INDEX IF NOT EXISTS idx_matriculas_data ON matriculas(data_matricula);

-- updated_at automático
CREATE OR REPLACE FUNCTION update_matriculas_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_matriculas_updated_at
  BEFORE UPDATE ON matriculas
  FOR EACH ROW EXECUTE FUNCTION update_matriculas_updated_at();

-- RLS
ALTER TABLE matriculas ENABLE ROW LEVEL SECURITY;

-- Qualquer autenticado pode ler (dashboard precisa contar)
CREATE POLICY "authenticated_read" ON matriculas
  FOR SELECT USING (auth.role() = 'authenticated');

-- Apenas admin pode inserir/atualizar
CREATE POLICY "admin_write" ON matriculas
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );
