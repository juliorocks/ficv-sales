-- Disciplinas de cada turma do Sponte (inclusive as que ainda não têm nota). O GetBoletim só
-- devolve disciplina que já tem nota consolidada, então turma com disciplinas sem nota sumia
-- no Portal (achado 22/10: Modular 1406, aluno 9740). Preenchida pelo levantamento que consulta
-- cada disciplina da matriz por turma (GetBoletim com nDisciplinaID); lida pelo Portal.
CREATE TABLE IF NOT EXISTS sponte_turma_disciplinas (
  turma_id      integer NOT NULL,
  disciplina_id integer NOT NULL,
  nome          text,
  modulo        integer,
  synced_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (turma_id, disciplina_id)
);
ALTER TABLE sponte_turma_disciplinas ENABLE ROW LEVEL SECURITY;
CREATE POLICY sponte_turma_disc_staff_select ON sponte_turma_disciplinas FOR SELECT USING (is_staff());
