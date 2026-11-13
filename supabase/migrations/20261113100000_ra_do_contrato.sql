-- RA "00:00:00": aluno cadastrado pela API do Sponte sem RA (Super Live) volta com esse valor. O RA de verdade é o
-- número do contrato antes da "/" (bate em 1.117 de 1.117 contas com RA numérico). Corrige as contas atuais e
-- mantém assim: gatilho em alunos (RA vazio/zerado) e em sponte_matriculas (contrato novo ou alterado).

CREATE INDEX IF NOT EXISTS idx_alunos_sponte_aluno_id ON public.alunos (sponte_aluno_id);

-- RA do aluno pelo contrato: Vigente primeiro, depois o mais recente
CREATE OR REPLACE FUNCTION public.ra_do_contrato(p_aluno_id integer) RETURNS text
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT split_part(numero_contrato, '/', 1)
    FROM public.sponte_matriculas
   WHERE aluno_id = p_aluno_id
     AND numero_contrato ~ '^[0-9]+(/|$)'
     AND split_part(numero_contrato, '/', 1) ~ '[1-9]'
   ORDER BY (situacao_id = 1) DESC NULLS LAST, data_matricula DESC NULLS LAST
   LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.alunos_ra_valido() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.ra IS NULL OR NEW.ra !~ '[1-9]' THEN
    NEW.ra := public.ra_do_contrato(NEW.sponte_aluno_id);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_alunos_ra_valido ON public.alunos;
CREATE TRIGGER trg_alunos_ra_valido BEFORE INSERT OR UPDATE OF ra ON public.alunos
  FOR EACH ROW EXECUTE FUNCTION public.alunos_ra_valido();

CREATE OR REPLACE FUNCTION public.matricula_atualiza_ra() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  UPDATE public.alunos a
     SET ra = public.ra_do_contrato(NEW.aluno_id)
   WHERE a.sponte_aluno_id = NEW.aluno_id
     AND (a.ra IS NULL OR a.ra !~ '[1-9]')
     AND public.ra_do_contrato(NEW.aluno_id) IS NOT NULL;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_matricula_atualiza_ra ON public.sponte_matriculas;
CREATE TRIGGER trg_matricula_atualiza_ra AFTER INSERT OR UPDATE OF numero_contrato ON public.sponte_matriculas
  FOR EACH ROW WHEN (NEW.numero_contrato IS NOT NULL) EXECUTE FUNCTION public.matricula_atualiza_ra();

-- Contas atuais: o gatilho de alunos troca o RA zerado pelo do contrato
UPDATE public.alunos SET ra = ra WHERE ra IS NULL OR ra !~ '[1-9]';
