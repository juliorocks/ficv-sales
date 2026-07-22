DO $$
DECLARE
  n bigint;
BEGIN
  SELECT count(*) INTO n FROM messages_logs;
  RAISE NOTICE 'messages_logs real count=%', n;

  SELECT count(*) INTO n FROM messages_logs WHERE agent_name IS NOT NULL AND agent_name <> 'Desconhecido';
  RAISE NOTICE 'messages_logs com agente real count=%', n;
END $$;
