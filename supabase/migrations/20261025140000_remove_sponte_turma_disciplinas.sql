-- Desfaz o mapeamento por turma: a consulta de disciplina por turma (GetBoletim com nDisciplinaID)
-- não separa as turmas — devolve as mesmas linhas para turmas diferentes do mesmo aluno. Os dados
-- gravados estavam errados, então a tabela e o agendamento saem.
DO $$
BEGIN
  PERFORM cron.unschedule('sponte-turma-disciplinas') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='sponte-turma-disciplinas');
END $$;
DROP TABLE IF EXISTS sponte_turma_disciplinas;
