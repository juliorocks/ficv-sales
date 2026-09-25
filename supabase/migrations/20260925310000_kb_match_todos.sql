-- consulta da base pelos atendentes pode buscar em TODOS os públicos ('todos')
CREATE OR REPLACE FUNCTION public.match_knowledge_chunks(
  query_embedding extensions.vector(1536),
  match_count     integer DEFAULT 6,
  min_similarity  double precision DEFAULT 0.25,
  p_publico       text DEFAULT 'vendas'
) RETURNS TABLE (document_id uuid, title text, category text, content text, similarity double precision)
LANGUAGE sql STABLE SET search_path = public, extensions AS $$
  SELECT c.document_id, kb.title, kb.category, c.content,
         1 - (c.embedding <=> query_embedding) AS similarity
    FROM knowledge_chunks c
    JOIN knowledge_base kb ON kb.id = c.document_id
   WHERE kb.ai_enabled
     AND (p_publico = 'todos' OR kb.publico IN (p_publico, 'ambos'))
     AND 1 - (c.embedding <=> query_embedding) >= min_similarity
   ORDER BY c.embedding <=> query_embedding
   LIMIT match_count;
$$;
