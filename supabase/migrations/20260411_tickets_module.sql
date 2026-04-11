-- ============================================================
-- MÓDULO DE TICKETS DE ATENDIMENTO - FICV
-- ============================================================

-- Enum: categorias de solicitação (opções prontas para o aluno)
CREATE TYPE ticket_categoria AS ENUM (
  'financeiro',
  'academico',
  'secretaria',
  'suporte_tecnico',
  'certificado',
  'cancelamento',
  'outros'
);

-- Enum: status do ticket
CREATE TYPE ticket_status AS ENUM (
  'aberto',
  'em_atendimento',
  'aguardando_aluno',
  'resolvido',
  'fechado'
);

-- Enum: prioridade
CREATE TYPE ticket_prioridade AS ENUM (
  'baixa',
  'media',
  'alta',
  'urgente'
);

-- ============================================================
-- TABELA: tickets
-- ============================================================
CREATE TABLE IF NOT EXISTS tickets (
  id             BIGSERIAL PRIMARY KEY,
  protocolo      TEXT NOT NULL UNIQUE,         -- ex: FICV-2026-00001
  titulo         TEXT NOT NULL,
  categoria      ticket_categoria NOT NULL,
  prioridade     ticket_prioridade NOT NULL DEFAULT 'media',
  status         ticket_status NOT NULL DEFAULT 'aberto',

  -- Aluno que abriu
  aluno_id       UUID NOT NULL REFERENCES auth.users(id),
  aluno_nome     TEXT NOT NULL,
  aluno_email    TEXT NOT NULL,

  -- Atendente responsável
  atendente_id   UUID REFERENCES auth.users(id),

  -- Timestamps
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  first_response_at TIMESTAMPTZ,              -- hora do 1º response do atendente (para TMA)
  resolved_at    TIMESTAMPTZ,                 -- hora da resolução (para FCR e tempo total)

  -- Avaliação (preenchida pelo aluno ao fechar)
  avaliado       BOOLEAN NOT NULL DEFAULT FALSE
);

-- Gerador de protocolo automático
CREATE OR REPLACE FUNCTION generate_ticket_protocolo()
RETURNS TRIGGER AS $$
DECLARE
  seq INT;
BEGIN
  SELECT COUNT(*) + 1 INTO seq FROM tickets;
  NEW.protocolo := 'FICV-' || TO_CHAR(NOW(), 'YYYY') || '-' || LPAD(seq::TEXT, 5, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ticket_protocolo
  BEFORE INSERT ON tickets
  FOR EACH ROW
  WHEN (NEW.protocolo IS NULL OR NEW.protocolo = '')
  EXECUTE FUNCTION generate_ticket_protocolo();

-- updated_at automático
CREATE OR REPLACE FUNCTION update_tickets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tickets_updated_at
  BEFORE UPDATE ON tickets
  FOR EACH ROW
  EXECUTE FUNCTION update_tickets_updated_at();

-- ============================================================
-- TABELA: ticket_messages (histórico da conversa)
-- ============================================================
CREATE TABLE IF NOT EXISTS ticket_messages (
  id             BIGSERIAL PRIMARY KEY,
  ticket_id      BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  autor_id       UUID NOT NULL REFERENCES auth.users(id),
  autor_nome     TEXT NOT NULL,
  autor_role     TEXT NOT NULL,               -- 'aluno' | 'atendente' | 'admin'
  conteudo       TEXT NOT NULL,
  interno        BOOLEAN NOT NULL DEFAULT FALSE, -- nota interna (não visível ao aluno)
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABELA: ticket_evaluations (avaliação do atendimento)
-- Métricas padrão de mercado: CSAT, FCR, CES
-- ============================================================
CREATE TABLE IF NOT EXISTS ticket_evaluations (
  id             BIGSERIAL PRIMARY KEY,
  ticket_id      BIGINT NOT NULL UNIQUE REFERENCES tickets(id) ON DELETE CASCADE,
  aluno_id       UUID NOT NULL REFERENCES auth.users(id),

  -- CSAT: Customer Satisfaction Score (1-5)
  csat_nota      SMALLINT NOT NULL CHECK (csat_nota BETWEEN 1 AND 5),

  -- CES: Customer Effort Score (1-7, quão fácil foi resolver)
  ces_nota       SMALLINT NOT NULL CHECK (ces_nota BETWEEN 1 AND 7),

  -- FCR: First Contact Resolution (resolvido no 1º contato?)
  fcr_resolvido  BOOLEAN NOT NULL DEFAULT FALSE,

  -- NPS parcial (0-10, recomendaria o atendimento?)
  nps_nota       SMALLINT CHECK (nps_nota BETWEEN 0 AND 10),

  comentario     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- RLS (Row Level Security)
-- ============================================================
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_evaluations ENABLE ROW LEVEL SECURITY;

-- tickets: aluno vê apenas os seus; atendente/admin veem todos
CREATE POLICY "tickets_aluno_select" ON tickets
  FOR SELECT USING (
    aluno_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'agent')
    )
  );

CREATE POLICY "tickets_aluno_insert" ON tickets
  FOR INSERT WITH CHECK (aluno_id = auth.uid());

CREATE POLICY "tickets_atendente_update" ON tickets
  FOR UPDATE USING (
    aluno_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'agent')
    )
  );

-- ticket_messages: mesma regra, mas notas internas só para staff
CREATE POLICY "messages_select" ON ticket_messages
  FOR SELECT USING (
    -- aluno vê tudo exceto internas
    (
      EXISTS (SELECT 1 FROM tickets WHERE id = ticket_id AND aluno_id = auth.uid())
      AND interno = FALSE
    )
    OR
    -- staff vê tudo
    EXISTS (
      SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'agent')
    )
  );

CREATE POLICY "messages_insert" ON ticket_messages
  FOR INSERT WITH CHECK (autor_id = auth.uid());

-- evaluations: aluno insere a sua; staff lê todas
CREATE POLICY "evaluations_insert" ON ticket_evaluations
  FOR INSERT WITH CHECK (aluno_id = auth.uid());

CREATE POLICY "evaluations_select" ON ticket_evaluations
  FOR SELECT USING (
    aluno_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'agent')
    )
  );

-- ============================================================
-- ÍNDICES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_tickets_aluno ON tickets(aluno_id);
CREATE INDEX IF NOT EXISTS idx_tickets_atendente ON tickets(atendente_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_created ON tickets(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket ON ticket_messages(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_eval_ticket ON ticket_evaluations(ticket_id);
