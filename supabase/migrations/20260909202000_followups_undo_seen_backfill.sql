-- ============================================================================
-- Desfaz o backfill de 20260909201000.
--
-- A ideia do backfill era não "acender" todo card no 1º load. Mas na prática os
-- leads em "Entrada" que têm mensagem do cliente e ZERO resposta de agente SÃO
-- exatamente os que precisam pulsar — é a fila de "aguardando atendimento".
-- Medição: dos 500 leads que o Kanban carrega, 118 se encaixam nisso.
--
-- lead_conversation_seen volta a ser preenchida só quando alguém abre a aba
-- Conversas / responde (via WideChatHistory). A guarda de 30 dias na view
-- continua (é inócua hoje — o board só carrega leads recentes — mas limita o
-- caso de alguém aumentar o limite de leads no futuro).
-- ============================================================================

TRUNCATE lead_conversation_seen;
