-- Alunos de teste: enquanto o formulário está em status 'teste', quem está nesta lista (sponte_aluno_id) vê a
-- avaliação no Portal e pelo link /avaliacao mesmo com portal_ativo desligado. Os demais alunos não veem nada.
ALTER TABLE public.cpa_formularios ADD COLUMN IF NOT EXISTS alunos_teste integer[] NOT NULL DEFAULT '{}';
