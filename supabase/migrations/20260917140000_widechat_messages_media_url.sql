-- Guarda a URL do arquivo/áudio de mídia (enviado por nós ou recebido do cliente),
-- pra dar pra abrir/conferir depois no histórico do Kanban. Até aqui só guardávamos
-- a legenda/nome como texto — sem link nenhum pro arquivo de verdade.
ALTER TABLE widechat_messages ADD COLUMN IF NOT EXISTS media_url text;
