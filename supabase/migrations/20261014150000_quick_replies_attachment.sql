-- Mensagens rápidas com anexo (PDF/imagem) — pedido do usuário 14/10: "Inserir nas mensagens
-- rápidas a opções de cadastrar documentos, como PDF, Imagens". O arquivo já sobe pro bucket
-- (widechat-attachments, já público) quando o atalho é salvo — usar o atalho depois nunca
-- precisa fazer upload de novo, só referencia a URL guardada aqui.
ALTER TABLE quick_replies
  ADD COLUMN IF NOT EXISTS attachment_url text,
  ADD COLUMN IF NOT EXISTS attachment_name text,
  ADD COLUMN IF NOT EXISTS attachment_mime text;
