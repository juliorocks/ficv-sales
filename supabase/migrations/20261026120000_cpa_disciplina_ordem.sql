-- Escolhas de nível da avaliação de disciplina na ordem do mais baixo para o mais alto (mesma leitura da escala de notas).
UPDATE public.cpa_perguntas
SET opcoes = '["Muito baixo", "Baixo", "Médio", "Alto", "Muito alto"]'::jsonb
WHERE tipo = 'escolha'
  AND formulario_id IN (SELECT id FROM public.cpa_formularios WHERE tipo = 'disciplina')
  AND opcoes @> '["Muito alto"]'::jsonb
  AND jsonb_array_length(opcoes) = 5;
