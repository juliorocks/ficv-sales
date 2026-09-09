-- O upload de conversas (CSVUploader) faz upsert em messages_logs com
-- onConflict:'protocol'. O rebuild do Postgres perdeu a constraint UNIQUE em
-- protocol -> todo upload falhava com 42P10 ("no unique or exclusion constraint
-- matching the ON CONFLICT specification") e o dashboard parava de receber dados.
-- (verificado 2026-09-09: 6908 linhas, 6908 protocolos distintos, 0 nulos.)

ALTER TABLE public.messages_logs
    ADD CONSTRAINT messages_logs_protocol_key UNIQUE (protocol);
