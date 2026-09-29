-- ============================================================================
-- Nova etapa "IA Atendendo" no Funil de Leads (28/09) — pedido do usuário, mesma ideia das
-- colunas de status dos Tickets: dá pra ver quem está sendo atendido pela IA agora, separado
-- de quem já tem um humano na conversa.
--
-- Fluxo (só toca Entrada/IA Atendendo/Em Contato — Matriculado/Perdido/Finalizado nunca mudam
-- por causa disso): Entrada → "IA Atendendo" na 1ª resposta de verdade da IA (vivaconnect-webhook
-- aiReply/advanceAiStage) → "Em Contato" quando um humano responde/assume (markHandedOff) OU
-- quando a própria IA decide fazer handoff (advanceAiStage com handoff=true).
--
-- `order` é integer sem espaço entre Entrada(1) e Em Contato(2) — reorganiza as etapas
-- seguintes pra abrir o 2 pra "IA Atendendo" (mexe só em `order`, os `id` de cada etapa não
-- mudam, então nada que referencia stage_id continua funcionando igual).
-- ============================================================================

UPDATE stages SET "order" = 6 WHERE id = 8; -- Finalizado
UPDATE stages SET "order" = 5 WHERE id = 7; -- Perdido
UPDATE stages SET "order" = 4 WHERE id = 6; -- Matriculado
UPDATE stages SET "order" = 3 WHERE id = 2; -- Em Contato

INSERT INTO stages (name, "order")
SELECT 'IA Atendendo', 2
WHERE NOT EXISTS (SELECT 1 FROM stages WHERE name ILIKE '%ia atend%');
