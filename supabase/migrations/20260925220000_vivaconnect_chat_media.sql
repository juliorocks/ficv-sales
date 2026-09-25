-- envio de mídia pelo chat do CRM via VivaConnect + nome do agente que enviou
ALTER TABLE vivaconnect_outbox
  ADD COLUMN IF NOT EXISTS media_url   text,
  ADD COLUMN IF NOT EXISTS media_type  text CHECK (media_type IN ('images','sounds','videos','files')),
  ADD COLUMN IF NOT EXISTS file_name   text,
  ADD COLUMN IF NOT EXISTS sender_name text;
