-- A avaliação deixa de ser anônima: a participação passa a guardar quem respondeu e qual resposta é dele,
-- para o aluno rever suas respostas no Portal. O vínculo fica na participação (não na cpa_respostas), então
-- a cadeia de hash das respostas oficiais e a imutabilidade delas não mudam.
ALTER TABLE public.cpa_participacoes ADD COLUMN IF NOT EXISTS aluno_id bigint;
ALTER TABLE public.cpa_participacoes ADD COLUMN IF NOT EXISTS resposta_id bigint REFERENCES public.cpa_respostas(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS cpa_participacoes_aluno_idx ON public.cpa_participacoes (aluno_id) WHERE aluno_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cpa_participacoes_resposta_idx ON public.cpa_participacoes (resposta_id) WHERE resposta_id IS NOT NULL;

UPDATE public.cpa_formularios
SET intro = replace(replace(intro, ' As respostas são anônimas e ajudam a FICV a melhorar.', ' Suas respostas ajudam a FICV a melhorar e você pode revê-las depois em Minhas avaliações.'),
                    ' As respostas são anônimas.', ' Você pode rever suas respostas depois, em Minhas avaliações.')
WHERE intro LIKE '%anônimas%';
