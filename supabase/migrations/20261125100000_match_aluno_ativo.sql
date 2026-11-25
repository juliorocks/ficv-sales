-- Aluno com matrícula ativa (Vigente ou Pré-Matrícula) pelo telefone. Usado pelo vivaconnect-webhook para
-- mandar para a etapa Aluno quem escreve pedindo suporte (2026-11-25). Ex-aluno cancelado/encerrado NÃO conta
-- (decisão de 19/11: a etapa Aluno não pode pegar ex-aluno pedindo curso).
CREATE OR REPLACE FUNCTION public.match_aluno_ativo_by_phone(p_phone text) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH d AS (SELECT public.phone_ddd8(p_phone) AS key)
  SELECT EXISTS (
    SELECT 1 FROM sponte_matriculas sm, d
     WHERE d.key IS NOT NULL AND sm.situacao_id IN (1, 6)
       AND public.phone_ddd8(sm.celular) = d.key);
$$;
GRANT EXECUTE ON FUNCTION public.match_aluno_ativo_by_phone(text) TO service_role;
