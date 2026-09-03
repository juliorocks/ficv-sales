-- O Kanban de Leads roda: SELECT * FROM leads ORDER BY data_entrada DESC LIMIT N
-- Sem índice em data_entrada isso é um full scan + sort de ~870k linhas e estoura
-- o statement_timeout (erro 57014) — mesmo com LIMIT 5. O índice DESC atende o
-- ORDER BY diretamente (index scan dos N primeiros, sem sort).
--
-- CONCURRENTLY não pode rodar dentro de bloco de transação, e migrations com mais
-- de um statement viram uma transação implícita — por isso este é o único
-- statement do arquivo (mesmo padrão de 20260728_idx_leads_normalized_nome.sql).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_data_entrada
  ON leads (data_entrada DESC);
