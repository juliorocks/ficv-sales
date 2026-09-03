-- ============================================================
-- Função de normalização de nome (sem acento, minúsculas, espaços
-- colapsados) usada para casar leads.nome_completo com
-- sponte_matriculas.aluno — não há CPF/telefone em comum entre
-- as duas bases, então o nome normalizado é a única chave possível.
-- Marcada IMMUTABLE pra poder ser usada em índice funcional.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE OR REPLACE FUNCTION normalize_name(name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(regexp_replace(trim(unaccent('unaccent', coalesce(name, ''))), '\s+', ' ', 'g'));
$$;
