-- Parcela de contrato cancelado não é dívida (2026-11-12, caso Salatiel dos Santos Ferreira, AlunoID 10958):
-- o Sponte cancelou o contrato POSTS e a matrícula "Pós-TS" saiu da tela, mas a API seguiu devolvendo a
-- parcela como Pendente. A categoria da parcela ("Matrícula Pós-TS") e a turma do contrato ("PÓS EAD - POSTS - 2026.2")
-- compartilham o código (TS). Se o aluno tem contrato Cancelado com esse código e nenhum outro ativo, a parcela
-- Pendente vira Cancelada. Só mexe em Pendente; só em categoria "Pós-XXX".
CREATE OR REPLACE FUNCTION public.codigo_pos_categoria(t text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT substring(translate(upper(coalesce(t, '')), 'ÓÍÃÉÚÇ', 'OIAEUC') from 'POS-([A-Z0-9]+)')
$$;

CREATE OR REPLACE FUNCTION public.codigo_pos_turma(t text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT substring(translate(upper(coalesce(t, '')), 'ÓÍÃÉÚÇ', 'OIAEUC') from '(?:^|[^A-Z0-9])POS([A-Z0-9]+)')
$$;

CREATE OR REPLACE FUNCTION public.parcela_de_contrato_cancelado(p_aluno_id bigint, p_categoria text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  WITH cod AS (SELECT public.codigo_pos_categoria(p_categoria) AS c)
  SELECT (SELECT c FROM cod) IS NOT NULL
     AND EXISTS (SELECT 1 FROM sponte_matriculas m
                  WHERE m.aluno_id = p_aluno_id AND m.situacao ILIKE 'cancel%'
                    AND public.codigo_pos_turma(m.nome_turma) = (SELECT c FROM cod))
     AND NOT EXISTS (SELECT 1 FROM sponte_matriculas m
                      WHERE m.aluno_id = p_aluno_id AND coalesce(m.situacao, '') NOT ILIKE 'cancel%'
                        AND public.codigo_pos_turma(m.nome_turma) = (SELECT c FROM cod))
$$;

CREATE OR REPLACE FUNCTION public.trg_parcela_contrato_cancelado() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.situacao_parcela = 'Pendente' AND NEW.aluno_id IS NOT NULL
     AND public.parcela_de_contrato_cancelado(NEW.aluno_id, NEW.categoria) THEN
    NEW.situacao_parcela := 'Cancelada';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS parcela_contrato_cancelado ON public.sponte_parcelas;
CREATE TRIGGER parcela_contrato_cancelado BEFORE INSERT OR UPDATE OF situacao_parcela, categoria, aluno_id
  ON public.sponte_parcelas FOR EACH ROW EXECUTE FUNCTION public.trg_parcela_contrato_cancelado();

-- Corrige o que já está no espelho.
UPDATE public.sponte_parcelas
   SET situacao_parcela = 'Cancelada'
 WHERE situacao_parcela = 'Pendente' AND aluno_id IS NOT NULL
   AND public.codigo_pos_categoria(categoria) IS NOT NULL
   AND public.parcela_de_contrato_cancelado(aluno_id, categoria);
