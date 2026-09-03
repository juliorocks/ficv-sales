-- Remove o índice que ficou inválido (build interrompido pelo erro de
-- tipo no unaccent) antes de recriá-lo com a função corrigida.
-- Sozinho no arquivo: DROP INDEX CONCURRENTLY não pode rodar dentro de
-- um bloco de transação.
DROP INDEX CONCURRENTLY IF EXISTS idx_leads_normalized_nome;
