-- ============================================================================
-- Alguns leads ficaram com o "telefone" = id INTERNO do WideChat ("US.21493...")
-- em vez do número real — o webhook pegava `platform_id` quando `vars.number` vinha
-- vazio (números estrangeiros). Com isso o envio pelo painel "dá sucesso" mas a
-- mensagem não chega (platform_id inválido pra /message/send).
--
-- O número real (`wa_id`) está no payload de `widechat_raw_messages`. Recupera dali.
-- (Hoje é só a Larissa — id 10503178 — mas deixa genérico.)
-- ============================================================================

WITH bad AS (
  SELECT l.id, l.widechat_session_id
  FROM leads l
  WHERE l.telefone !~ '^\+?\d{10,15}$'
    AND coalesce(l.widechat_session_id, '') <> ''
),
real_num AS (
  SELECT b.id,
         (SELECT r.payload #>> '{data,content,wa_id}'
          FROM widechat_raw_messages r
          WHERE r.session_id = b.widechat_session_id
            AND (r.payload #>> '{data,content,wa_id}') ~ '^\d{10,15}$'
          ORDER BY r.created_at
          LIMIT 1) AS wa_id
  FROM bad b
)
UPDATE leads l
SET telefone = real_num.wa_id, updated_at = now()
FROM real_num
WHERE l.id = real_num.id AND real_num.wa_id IS NOT NULL;
