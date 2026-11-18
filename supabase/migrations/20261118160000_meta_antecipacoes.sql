-- Antecipações (aluno pagou o semestre ou o curso inteiro de uma vez) que entram na meta financeira.
-- Mensalidade não conta na meta, só matrícula; estes pagamentos são exceção decidida pelo usuário (2026-11-18).
-- Graduação ficou de fora. Novos casos: INSERT aqui (admin), com data do pagamento e valor pago.
CREATE TABLE IF NOT EXISTS public.meta_antecipacoes (
  id bigserial PRIMARY KEY,
  sponte_aluno_id integer,
  aluno text NOT NULL,
  curso text,
  data_pagamento date NOT NULL,
  valor numeric(12,2) NOT NULL CHECK (valor > 0),
  como_pagou text,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS meta_antecipacoes_data_idx ON public.meta_antecipacoes (data_pagamento);
ALTER TABLE public.meta_antecipacoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY meta_antecipacoes_select ON public.meta_antecipacoes FOR SELECT TO authenticated USING (public.is_staff());
CREATE POLICY meta_antecipacoes_admin ON public.meta_antecipacoes FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

INSERT INTO public.meta_antecipacoes (sponte_aluno_id, aluno, curso, data_pagamento, valor, como_pagou) VALUES
  (9450, 'Lidiane Vieira Cardoso De Souza', 'Pós Educação Cristã Clássica', '2026-01-10', 3833.28, 'parcela única'),
  (9571, 'Letícia Fonseca de Souza Andrade', 'Pós Educação Cristã Clássica', '2026-02-23', 3833.28, 'parcela única'),
  (9804, 'Matheus Simoes Da Silva', 'Pós Teologia Bíblica e Exegética do NT', '2026-04-06', 1617.15, 'parcela única'),
  (7905, 'Marilia Chimara', 'Pós Psicopedagogia', '2026-04-10', 3258.22, 'parcela única'),
  (4256, 'Josy Cerqueira Haliski', 'Pós Educação Cristã Clássica', '2026-04-17', 2720.00, 'parcela única'),
  (9998, 'Roberta Amaral Sena De Almeida', 'Pós Psicoteologia', '2026-04-30', 1509.41, 'pagou tudo no dia'),
  (4366, 'Luciana Araujo De Franca Ayres', 'Pós Educação Cristã Clássica', '2026-05-12', 1839.94, 'parcela única'),
  (9550, 'Etina Morisco Souza Lamin', 'Pós Educação Cristã Clássica', '2026-06-12', 3114.54, 'pagou tudo no dia'),
  (7085, 'Raquel Rodrigues Abreu Do Nascimento', 'Pós Educação Cristã Clássica', '2026-06-12', 1868.82, 'pagou tudo no dia'),
  (10249, 'Arli Rejane Wachholz', 'Pós Liderança Cristã', '2026-07-03', 808.65, 'pagou tudo no dia'),
  (10692, 'Leslie Ricardo Pinheiro Lima', 'Pós Teologia Sistemática', '2026-09-10', 1724.96, 'parcela única'),
  (9796, 'Mariano Valdevino Ferreira Neto', 'Pós Liderança Cristã', '2026-09-17', 1509.35, 'pagou tudo no dia'),
  (10742, 'Maria Cristina de Souza Teodoro', 'Pós Educação Cristã Clássica', '2026-09-22', 3066.56, 'parcela única'),
  (10721, 'Márcia Helena Azevedo Santos', 'Pós Gestão Escolar', '2026-09-22', 3066.56, 'parcela única');
