-- Índice funcional sozinho neste arquivo (mesmo motivo do índice de leads).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sponte_matriculas_normalized_aluno
  ON sponte_matriculas (normalize_name(aluno));
