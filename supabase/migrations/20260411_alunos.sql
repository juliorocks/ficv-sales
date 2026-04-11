-- ============================================================
-- TABELA: alunos
-- Alunos se cadastram via Supabase Auth (email/senha)
-- O CPF é armazenado aqui como identificador único
-- ============================================================

CREATE TABLE IF NOT EXISTS alunos (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  cpf         TEXT NOT NULL UNIQUE,   -- formato: 000.000.000-00
  nome        TEXT NOT NULL,
  email       TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índice por CPF para busca rápida
CREATE UNIQUE INDEX IF NOT EXISTS idx_alunos_cpf ON alunos(cpf);

-- updated_at automático
CREATE OR REPLACE FUNCTION update_alunos_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_alunos_updated_at
  BEFORE UPDATE ON alunos
  FOR EACH ROW EXECUTE FUNCTION update_alunos_updated_at();

-- RLS
ALTER TABLE alunos ENABLE ROW LEVEL SECURITY;

-- Aluno só vê/edita o próprio registro
CREATE POLICY "aluno_select_own" ON alunos
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "aluno_update_own" ON alunos
  FOR UPDATE USING (auth.uid() = id);

-- Qualquer autenticado pode inserir (no signup)
CREATE POLICY "aluno_insert_own" ON alunos
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Staff (admin/agent via profiles) pode ver todos
CREATE POLICY "staff_select_all" ON alunos
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('admin', 'agent')
    )
  );

-- ============================================================
-- Ajusta tickets: aluno_id → alunos
-- ============================================================

-- Adiciona FK de tickets.aluno_id para alunos
ALTER TABLE tickets
  ADD CONSTRAINT tickets_aluno_fkey
  FOREIGN KEY (aluno_id) REFERENCES alunos(id) ON DELETE CASCADE;

-- RLS para tickets: aluno vê apenas os seus
-- (policies já criadas na migration principal, mas garante que aluno_id = auth.uid())
