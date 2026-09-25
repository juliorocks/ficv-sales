-- Documento ESSENCIAL (⭐): referência central (ex.: "Orientações Gerais" com preços,
-- durações e turmas). No empate da busca por palavra ele entra primeiro — "preço da pós
-- em História do Cristianismo" empatava com 4 PPCs que citam história/cristianismo e o
-- documento com o preço ficava de fora (25/09).
ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS essencial boolean NOT NULL DEFAULT false;
UPDATE knowledge_base SET essencial = true WHERE title ILIKE 'orienta%es gerais%';

CREATE OR REPLACE FUNCTION public.match_knowledge_keywords(
  p_terms   text[],
  p_publico text DEFAULT 'todos',
  p_limit   integer DEFAULT 4
) RETURNS TABLE (document_id uuid, title text, category text, content text, similarity double precision)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT x.document_id, x.title, x.category, x.content, x.similarity FROM (
    SELECT DISTINCT ON (c.document_id) c.document_id, kb.title, kb.category, c.content, kb.essencial,
           (SELECT count(*) FROM unnest(p_terms) t WHERE c.content ILIKE '%' || t || '%')::double precision
             / greatest(array_length(p_terms, 1), 1) AS similarity,
           (SELECT count(*) FROM unnest(p_terms) t WHERE kb.title ILIKE '%' || t || '%') AS no_titulo
      FROM knowledge_chunks c
      JOIN knowledge_base kb ON kb.id = c.document_id
     WHERE kb.ai_enabled
       AND (p_publico = 'todos' OR kb.publico IN (p_publico, 'ambos'))
       AND EXISTS (SELECT 1 FROM unnest(p_terms) t WHERE c.content ILIKE '%' || t || '%')
     ORDER BY c.document_id, 6 DESC, length(c.content)
  ) x
  -- mais termos casados; no empate: documento essencial, depois o doc cujo TÍTULO tem o termo (o PPC do curso)
  ORDER BY x.similarity DESC, x.essencial DESC, x.no_titulo DESC, length(x.content)
  LIMIT p_limit;
$$;
