-- Mapeia uma turma nova por execução (ver sponte-turma-disciplinas). Turmas já mapeadas são puladas.
DO $$
BEGIN
  PERFORM cron.unschedule('sponte-turma-disciplinas') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='sponte-turma-disciplinas');
  PERFORM cron.schedule('sponte-turma-disciplinas', '*/5 * * * *',
    $c$SELECT public.cron_call('sponte-turma-disciplinas')$c$);
END $$;
