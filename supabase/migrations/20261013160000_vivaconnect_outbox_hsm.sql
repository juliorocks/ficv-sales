-- Envio de template (HSM) aprovado pelo VivaConnect/Z-PRO (13/10). Até aqui só dava pra
-- VISUALIZAR os templates da Meta — enviar continuava bloqueado ("Templates ainda não estão
-- disponíveis pelo VivaConnect", WideChatHistory.tsx). vivaconnect-api usa o endpoint externo
-- /template do Z-PRO, que espera o payload cru da Cloud API da Meta (messaging_product/to/
-- type/template{name,language,components}) — essas colunas guardam o que falta montar isso.
ALTER TABLE vivaconnect_outbox
  ADD COLUMN IF NOT EXISTS hsm_template_name text,
  ADD COLUMN IF NOT EXISTS hsm_language text,
  ADD COLUMN IF NOT EXISTS hsm_components jsonb;
