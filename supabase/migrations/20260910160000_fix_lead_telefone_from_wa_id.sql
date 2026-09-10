-- ============================================================================
-- (revertido) — este migration TROCAVA leads.telefone pelo `wa_id` quando o valor
-- salvo era um id interno do WideChat ("US.21493..."). ERRADO: o `/message/send` do
-- WideChat espera justamente esse id interno como `platform_id`; o `wa_id` (número
-- de exibição) a Meta recusa como recipient → erro 131026 "undeliverable".
--
-- Mantido como no-op só pra não quebrar a sequência de migrations. O tratamento
-- correto está no widechat-webhook (guarda o platform_id) e no widechat-api
-- (passa o platform_id cru, sem `brDigits`, quando tem prefixo de letra).
-- ============================================================================

SELECT 1;
