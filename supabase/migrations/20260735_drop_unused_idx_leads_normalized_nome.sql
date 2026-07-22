-- Índice em leads não é mais usado (a atribuição por agente agora usa
-- messages_logs, não leads) — remove pra não pagar overhead de escrita
-- à toa numa tabela com ~770 mil linhas e inserts em tempo real via
-- webhook. Sozinho no arquivo: DROP INDEX CONCURRENTLY não pode rodar
-- dentro de um bloco de transação.
DROP INDEX CONCURRENTLY IF EXISTS idx_leads_normalized_nome;
