-- Busca por PALAVRA na base (complementa a busca vetorial): trechos que contêm os termos
-- da pergunta, ordenados por quantos termos casam. Motivo (25/09): "pós em Psicoteologia"
-- trazia o PPC de Psicopedagogia (nome parecido no espaço vetorial) e perdia o trecho de
-- "Orientações Gerais" que tinha a resposta.
CREATE OR REPLACE FUNCTION public.match_knowledge_keywords(
  p_terms   text[],
  p_publico text DEFAULT 'todos',
  p_limit   integer DEFAULT 4
) RETURNS TABLE (document_id uuid, title text, category text, content text, similarity double precision)
LANGUAGE sql STABLE SET search_path = public AS $$
  -- melhor trecho de CADA documento (senão um PPC grande ocupa todas as vagas e o
  -- documento geral com preço/duração fica de fora)
  SELECT * FROM (
    SELECT DISTINCT ON (c.document_id) c.document_id, kb.title, kb.category, c.content,
           (SELECT count(*) FROM unnest(p_terms) t WHERE c.content ILIKE '%' || t || '%')::double precision
             / greatest(array_length(p_terms, 1), 1) AS similarity
      FROM knowledge_chunks c
      JOIN knowledge_base kb ON kb.id = c.document_id
     WHERE kb.ai_enabled
       AND (p_publico = 'todos' OR kb.publico IN (p_publico, 'ambos'))
       AND EXISTS (SELECT 1 FROM unnest(p_terms) t WHERE c.content ILIKE '%' || t || '%')
     ORDER BY c.document_id, 5 DESC, length(c.content)
  ) x
  ORDER BY similarity DESC, length(content)
  LIMIT p_limit;
$$;
REVOKE EXECUTE ON FUNCTION public.match_knowledge_keywords(text[], text, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.match_knowledge_keywords(text[], text, integer) TO service_role;
