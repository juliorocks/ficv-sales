-- Índice funcional sozinho neste arquivo (CONCURRENTLY não pode rodar
-- dentro de um bloco de transação, e migrations com mais de um
-- statement são enviadas como uma transação implícita).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_normalized_nome
  ON leads (normalize_name(nome_completo));
