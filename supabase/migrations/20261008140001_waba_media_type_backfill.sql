-- Mensagens de mídia recebidas pelo WABA (áudio/imagem) ficavam classificadas como
-- type='text', message='' (bolha em branco no chat, sem player) — parseWebhook() só
-- reconhecia os tipos de mídia do Baileys, não os do WABA (ver 20261008XXXXXX em
-- _shared/vivaconnect.ts, fix ao vivo 08/10, lead "Edson Eloi"). Reclassifica as 5 linhas
-- já gravadas assim pra que o lazy-fetch de mídia do WideChatHistory.tsx (dispara quando
-- type é de mídia e media_url ainda não foi resolvido) passe a buscar o link de verdade.
UPDATE widechat_messages
   SET type = CASE raw_data->'msg'->>'type'
                WHEN 'audio' THEN 'sounds'
                WHEN 'image' THEN 'images'
              END
 WHERE provider = 'vivaconnect'
   AND (message IS NULL OR message = '')
   AND type = 'text'
   AND raw_data->'msg'->>'type' IN ('audio', 'image');
