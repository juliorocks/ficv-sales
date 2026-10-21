-- Painel de análise recarrega sozinho quando sai uma avaliação nova (2026-10-23).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'messages_logs') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages_logs;
  END IF;
END $$;
