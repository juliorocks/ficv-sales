-- Celular/telefone/e-mail do cadastro do aluno no Sponte (GetAlunos), 2026-11-18.
-- sponte_matriculas.celular está vazio para a maioria (GetMatriculas não traz); caso Monica (AlunoID 4617): tem celular no Sponte
-- e aparecia "sem WhatsApp" na Inadimplência. A carga grava aqui e copia para sponte_matriculas.celular (usado por todas as RPCs).
CREATE TABLE IF NOT EXISTS public.sponte_alunos_contato (
  aluno_id   integer PRIMARY KEY,
  celular    text,
  telefone   text,
  email      text,
  synced_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.sponte_alunos_contato ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.sponte_contatos_aplicar() RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path = public SET statement_timeout = '5min' AS $$
  WITH u AS (
    UPDATE sponte_matriculas m
       SET celular = COALESCE(NULLIF(regexp_replace(c.celular, '\D', '', 'g'), ''), NULLIF(regexp_replace(c.telefone, '\D', '', 'g'), ''))
      FROM sponte_alunos_contato c
     WHERE c.aluno_id = m.aluno_id
       AND COALESCE(m.celular, '') = ''
       AND COALESCE(NULLIF(regexp_replace(c.celular, '\D', '', 'g'), ''), NULLIF(regexp_replace(c.telefone, '\D', '', 'g'), '')) IS NOT NULL
    RETURNING 1)
  SELECT count(*)::int FROM u;
$$;
REVOKE ALL ON FUNCTION public.sponte_contatos_aplicar() FROM PUBLIC, anon, authenticated;
