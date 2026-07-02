-- ============================================================
-- TABELAS: integração Sponte CRM
-- sync-sponte Edge Function escreve aqui diariamente
-- ============================================================

-- Matrículas vindas do Sponte
CREATE TABLE IF NOT EXISTS sponte_matriculas (
  id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  contrato_id           INTEGER NOT NULL UNIQUE,
  aluno_id              INTEGER NOT NULL,
  aluno                 TEXT,
  turma_id              INTEGER,
  nome_turma            TEXT,
  nome_curso            TEXT,
  curso_id              TEXT,
  situacao_id           INTEGER,
  situacao              TEXT,
  data_matricula        DATE,
  data_inicio           DATE,
  data_termino          DATE,
  data_encerramento     DATE,
  contratante           TEXT,
  numero_contrato       TEXT,
  financeiro_lancado    TEXT,
  nome_matriz_curricular TEXT,
  tipo_contrato_id      INTEGER,
  synced_at             TIMESTAMPTZ DEFAULT now(),
  created_at            TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sponte_mat_data    ON sponte_matriculas(data_matricula);
CREATE INDEX IF NOT EXISTS idx_sponte_mat_turma   ON sponte_matriculas(turma_id);
CREATE INDEX IF NOT EXISTS idx_sponte_mat_curso   ON sponte_matriculas(nome_curso);
CREATE INDEX IF NOT EXISTS idx_sponte_mat_situacao ON sponte_matriculas(situacao_id);

-- Parcelas financeiras vindas do Sponte
CREATE TABLE IF NOT EXISTS sponte_parcelas (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  conta_receber_id  BIGINT NOT NULL,
  numero_parcela    TEXT,
  aluno_id          INTEGER,
  situacao_parcela  TEXT,
  data_pagamento    DATE,
  vencimento        DATE,
  valor_parcela     NUMERIC(12,2),
  valor_pago        NUMERIC(12,2),
  forma_cobranca    TEXT,
  categoria         TEXT,
  categoria_id      INTEGER,
  sacado            TEXT,
  conta_creditar    TEXT,
  synced_at         TIMESTAMPTZ DEFAULT now(),
  UNIQUE(conta_receber_id, numero_parcela)
);

CREATE INDEX IF NOT EXISTS idx_sponte_parc_pagamento  ON sponte_parcelas(data_pagamento);
CREATE INDEX IF NOT EXISTS idx_sponte_parc_vencimento ON sponte_parcelas(vencimento);
CREATE INDEX IF NOT EXISTS idx_sponte_parc_aluno      ON sponte_parcelas(aluno_id);
CREATE INDEX IF NOT EXISTS idx_sponte_parc_situacao   ON sponte_parcelas(situacao_parcela);

-- RLS
ALTER TABLE sponte_matriculas ENABLE ROW LEVEL SECURITY;
ALTER TABLE sponte_parcelas   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_read_sponte_mat" ON sponte_matriculas
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "authenticated_read_sponte_parc" ON sponte_parcelas
  FOR SELECT USING (auth.role() = 'authenticated');

-- Service role pode escrever (Edge Function usa service role key)
CREATE POLICY "service_write_sponte_mat" ON sponte_matriculas
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "service_write_sponte_parc" ON sponte_parcelas
  FOR ALL USING (auth.role() = 'service_role');
