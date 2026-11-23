-- Painel do Projeto: situação do diagnóstico do TI por setor e unidade (quem preencheu, quando, o que falta).
CREATE TABLE IF NOT EXISTS public.projeto_diagnostico (
  id           serial PRIMARY KEY,
  unidade      text NOT NULL CHECK (unidade IN ('faculdade','escola')),
  setor        text NOT NULL,
  responsavel  text,
  preenchido_em date,
  situacao     text NOT NULL DEFAULT 'em_branco' CHECK (situacao IN ('em_branco','so_responsavel','preenchido')),
  obs          text,
  ordem        int NOT NULL DEFAULT 0,
  UNIQUE (unidade, setor)
);
ALTER TABLE public.projeto_diagnostico ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS projeto_diagnostico_admin ON public.projeto_diagnostico;
CREATE POLICY projeto_diagnostico_admin ON public.projeto_diagnostico FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

INSERT INTO public.projeto_diagnostico (unidade, setor, responsavel, preenchido_em, situacao, obs, ordem) VALUES
  ('faculdade','Secretaria e acadêmico','Tyago Mendes','2026-11-16','preenchido',NULL,1),
  ('faculdade','Financeiro','Thayce',NULL,'preenchido','Sugestões de pagamentos, fiscal e contábil anexadas',2),
  ('faculdade','Compras','Paulo Pires',NULL,'so_responsavel',NULL,3),
  ('faculdade','Patrimônio e almoxarifado','Felinto',NULL,'so_responsavel','O da Escola já foi preenchido',4),
  ('faculdade','Espaços e agendamentos','Marcele',NULL,'so_responsavel',NULL,5),
  ('faculdade','Pedagógico','Victor Grisi','2026-11-17','preenchido','CPA, AVA, Portal do Aluno e Portal dos Polos EAD',6),
  ('faculdade','TI','',NULL,'em_branco',NULL,7),
  ('escola','Secretaria e acadêmico','Bruna Silva','2026-11-09','preenchido',NULL,1),
  ('escola','Financeiro',NULL,NULL,'preenchido','Levantamento de Contas a Receber (10 processos), sem responsável identificado',2),
  ('escola','Compras',NULL,NULL,'em_branco',NULL,3),
  ('escola','Patrimônio e almoxarifado','Felinto Monteiro','2026-11-18','preenchido','Parte do que o app Aquila faz hoje',4),
  ('escola','Espaços e agendamentos',NULL,NULL,'em_branco',NULL,5),
  ('escola','Pedagógico',NULL,NULL,'em_branco',NULL,6),
  ('escola','TI',NULL,NULL,'em_branco',NULL,7)
ON CONFLICT (unidade, setor) DO NOTHING;
