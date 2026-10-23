-- Avaliação de disciplinas pelo Moodle: a disciplina ativa do aluno é o curso do Moodle em que ele está
-- inscrito no semestre atual, e o professor vem do mesmo curso (editingteacher). Onde o Moodle não tem
-- professor (pós), a equipe preenche no painel (origem 'manual'); a sincronização não sobrescreve.
ALTER TABLE public.cpa_formularios ADD COLUMN IF NOT EXISTS semestre text;
ALTER TABLE public.cpa_formularios DROP CONSTRAINT IF EXISTS cpa_formularios_semestre_chk;
ALTER TABLE public.cpa_formularios ADD CONSTRAINT cpa_formularios_semestre_chk CHECK (semestre IS NULL OR semestre ~ '^\d{4}\.[12]$');

ALTER TABLE public.cpa_docentes ALTER COLUMN docente DROP NOT NULL;
ALTER TABLE public.cpa_docentes ALTER COLUMN moodle_course_id DROP NOT NULL;
ALTER TABLE public.cpa_docentes ADD COLUMN IF NOT EXISTS origem text NOT NULL DEFAULT 'moodle';
ALTER TABLE public.cpa_docentes DROP CONSTRAINT IF EXISTS cpa_docentes_origem_chk;
ALTER TABLE public.cpa_docentes ADD CONSTRAINT cpa_docentes_origem_chk CHECK (origem IN ('moodle', 'manual'));
ALTER TABLE public.cpa_docentes ADD COLUMN IF NOT EXISTS periodo_nome text;
ALTER TABLE public.cpa_docentes ADD COLUMN IF NOT EXISTS disciplina_nome text;
