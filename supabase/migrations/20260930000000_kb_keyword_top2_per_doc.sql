-- match_knowledge_keywords trazia só o MELHOR trecho de cada documento (DISTINCT ON). Achado
-- ao vivo (30/09): um PPC pode ter DOIS trechos que empatam nos termos de busca — um genérico
-- ("o corpo docente é formado por doutores e mestres", sem nomes) e outro com a tabela de
-- nomes de verdade ("Docente | Titulação | ... Gustavo Castello Branco ...") — e o desempate por
-- tamanho às vezes escolhia o genérico, deixando a IA sem a lista real mesmo ela existindo na
-- base. Agora traz até 2 trechos por documento (ainda ordenados/cortados por p_limit no total).
CREATE OR REPLACE FUNCTION public.match_knowledge_keywords(
  p_terms   text[],
  p_publico text DEFAULT 'todos',
  p_limit   integer DEFAULT 4
) RETURNS TABLE (document_id uuid, title text, category text, content text, similarity double precision)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT document_id, title, category, content, similarity FROM (
    SELECT c.document_id, kb.title, kb.category, c.content,
           (SELECT count(*) FROM unnest(p_terms) t WHERE c.content ILIKE '%' || t || '%')::double precision
             / greatest(array_length(p_terms, 1), 1) AS similarity,
           ROW_NUMBER() OVER (PARTITION BY c.document_id ORDER BY
             (SELECT count(*) FROM unnest(p_terms) t WHERE c.content ILIKE '%' || t || '%') DESC,
             length(c.content) ASC) AS rn
      FROM knowledge_chunks c
      JOIN knowledge_base kb ON kb.id = c.document_id
     WHERE kb.ai_enabled
       AND (p_publico = 'todos' OR kb.publico IN (p_publico, 'ambos'))
       AND EXISTS (SELECT 1 FROM unnest(p_terms) t WHERE c.content ILIKE '%' || t || '%')
  ) x
  WHERE rn <= 2
  ORDER BY similarity DESC, length(content)
  LIMIT p_limit;
$$;
