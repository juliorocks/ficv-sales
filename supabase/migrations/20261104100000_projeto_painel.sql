-- Painel do Projeto (Gestão > Painel do Projeto, só admin): frentes de trabalho, tarefas, marcos e registro
-- do desenvolvimento do Super Portal Cidade Viva. Leitura e escrita só do admin (is_admin()).

CREATE TABLE IF NOT EXISTS public.projeto_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  nome text NOT NULL,
  inicio date NOT NULL,
  fim date NOT NULL,
  duracao_meses int NOT NULL
);

CREATE TABLE IF NOT EXISTS public.projeto_frentes (
  id text PRIMARY KEY,
  sistema text NOT NULL CHECK (sistema IN ('projeto', 'ficv', 'escola', 'gerencial')),
  nome text NOT NULL,
  descricao text,
  inicio date,
  fim date,
  ordem int NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.projeto_tarefas (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  frente_id text NOT NULL REFERENCES public.projeto_frentes(id) ON UPDATE CASCADE ON DELETE CASCADE,
  titulo text NOT NULL,
  status text NOT NULL DEFAULT 'planejado' CHECK (status IN ('planejado', 'andamento', 'concluido', 'bloqueado')),
  progresso int NOT NULL DEFAULT 0 CHECK (progresso BETWEEN 0 AND 100),
  inicio date,
  fim date,
  concluido_em date,
  prioridade text NOT NULL DEFAULT 'normal' CHECK (prioridade IN ('normal', 'alta')),
  previo boolean NOT NULL DEFAULT false,
  ordem int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS projeto_tarefas_frente_idx ON public.projeto_tarefas (frente_id);

CREATE TABLE IF NOT EXISTS public.projeto_marcos (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  titulo text NOT NULL,
  data date,
  feito boolean NOT NULL DEFAULT false,
  ordem int NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.projeto_registro (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  data date NOT NULL DEFAULT current_date,
  texto text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['projeto_config', 'projeto_frentes', 'projeto_tarefas', 'projeto_marcos', 'projeto_registro'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_admin', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin())', t || '_admin', t);
  END LOOP;
END $$;

INSERT INTO public.projeto_config (id, nome, inicio, fim, duracao_meses)
VALUES (true, 'Super Portal Cidade Viva', '2026-11-01', '2028-01-31', 15)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.projeto_frentes (id, sistema, nome, descricao, ordem) VALUES
  ('gestao', 'projeto', 'Gestão do projeto', 'Acompanhamento, calendário por módulo e documentação.', 1),
  ('aws', 'projeto', 'Migração para a AWS', 'Levar todo o sistema atual para o servidor AWS da Cidade Viva.', 2),
  ('ficv-crm', 'ficv', 'CRM e captação de alunos', 'Funil de matrículas, WhatsApp, e-mail, marketing e metas do Comercial.', 3),
  ('ficv-ate', 'ficv', 'Atendimento ao aluno', 'Chamados, Tutor Virtual e Base de Conhecimento.', 4),
  ('ficv-sec', 'ficv', 'Secretaria e acadêmico', 'Portal do Aluno, matrículas, turmas, notas e documentos, no lugar do Sponte.', 5),
  ('ficv-fin', 'ficv', 'Financeiro do aluno', 'Parcelas, segunda via, pagamento e demonstrativo para o Imposto de Renda.', 6),
  ('ficv-ava', 'ficv', 'AVA e avaliações', 'Aulas, provas e acompanhamento do estudo do aluno.', 7),
  ('ficv-cpa', 'ficv', 'Avaliação institucional (CPA)', 'Formulários, resultados e relatórios da CPA.', 8),
  ('ficv-com', 'ficv', 'Comunicação e relacionamento', 'E-mail, eventos, agenda, site e atendimento.', 9),
  ('ficv-doc', 'ficv', 'Contratos e diplomas', 'Assinatura eletrônica, diploma pela B4 e verificação.', 10),
  ('ficv-app', 'ficv', 'Aplicativos', 'Apps nas lojas da Apple e do Google.', 11),
  ('esc-mat', 'escola', 'Matrículas', 'Cadastro e gerenciamento das matrículas da escola.', 12),
  ('esc-fila', 'escola', 'Fila de espera', 'Candidatos aguardando vaga.', 13),
  ('esc-ate', 'escola', 'Atendimento', 'Atendimento unificado, agendamento e documentos automáticos.', 14),
  ('esc-ger', 'escola', 'Gestão escolar', 'Alunos, professores, diários de classe e portal dos pais.', 15),
  ('esc-fin', 'escola', 'Financeiro escolar', 'Matrículas, mensalidades, pagamento e Imposto de Renda.', 16),
  ('ger-fin', 'gerencial', 'Financeiro', 'Entradas, saídas, conciliação, balancete, razão, repasses e nota fiscal.', 17),
  ('ger-com', 'gerencial', 'Compras e patrimônio', 'Contas a pagar, lançamentos por setor e gestão de patrimônio.', 18),
  ('ger-dad', 'gerencial', 'Visão unificada e relatórios', 'Dados da Fundação, da Escola e da Faculdade em um só lugar.', 19)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.projeto_tarefas (frente_id, titulo, status, progresso, inicio, fim, concluido_em, prioridade, previo, ordem) VALUES
  ('gestao', 'Painel de acompanhamento do projeto', 'concluido', 100, '2026-11-04', '2026-11-04', '2026-11-04', 'normal', false, 1),
  ('gestao', 'Calendário e prioridade de cada módulo, definidos com a equipe de implementação', 'planejado', 0, NULL, NULL, NULL, 'alta', false, 2),
  ('gestao', 'Documentação do sistema, produzida junto com o desenvolvimento', 'planejado', 0, NULL, NULL, NULL, 'normal', false, 3),
  ('aws', 'Plano de migração para a AWS', 'planejado', 0, NULL, NULL, NULL, 'alta', false, 4),
  ('aws', 'Inventário do que será migrado', 'planejado', 0, NULL, NULL, NULL, 'alta', false, 5),
  ('aws', 'Banco de dados (Postgres)', 'planejado', 0, NULL, NULL, NULL, 'normal', false, 6),
  ('aws', 'Funções de backend (Edge Functions)', 'planejado', 0, NULL, NULL, NULL, 'normal', false, 7),
  ('aws', 'Arquivos e imagens (storage)', 'planejado', 0, NULL, NULL, NULL, 'normal', false, 8),
  ('aws', 'Login, permissões e segredos', 'planejado', 0, NULL, NULL, NULL, 'normal', false, 9),
  ('aws', 'Tarefas agendadas (crons e rotinas do GitHub)', 'planejado', 0, NULL, NULL, NULL, 'normal', false, 10),
  ('aws', 'Hospedagem do site (hoje na Vercel)', 'planejado', 0, NULL, NULL, NULL, 'normal', false, 11),
  ('aws', 'Testes em paralelo, virada e plano de volta', 'planejado', 0, NULL, NULL, NULL, 'normal', false, 12),
  ('ficv-crm', 'Funil de matrículas em Kanban, com atendimento pelo WhatsApp (VivaConnect e WideChat)', 'concluido', 100, NULL, NULL, NULL, 'normal', true, 13),
  ('ficv-crm', 'Vivi, a IA de atendimento de vendas, com triagem do Hub do Grupo', 'concluido', 100, NULL, NULL, NULL, 'normal', true, 14),
  ('ficv-crm', 'Envio e recebimento de e-mail dentro da conversa do lead', 'concluido', 100, NULL, NULL, NULL, 'normal', true, 15),
  ('ficv-crm', 'Follow-ups, aviso de resposta pendente e som de lead novo', 'concluido', 100, NULL, NULL, NULL, 'normal', true, 16),
  ('ficv-crm', 'Formulários de marketing que viram lead, e integração com o SendPulse', 'concluido', 100, NULL, NULL, NULL, 'normal', true, 17),
  ('ficv-crm', 'Painel de campanhas (Meta Ads e Google Ads)', 'concluido', 100, NULL, NULL, NULL, 'normal', true, 18),
  ('ficv-crm', 'Metas e desempenho dos agentes, ao vivo pelo Sponte', 'concluido', 100, NULL, NULL, NULL, 'normal', true, 19),
  ('ficv-crm', 'Equipe: usuários, departamentos, perfis e permissões', 'concluido', 100, NULL, NULL, NULL, 'normal', true, 20),
  ('ficv-ate', 'Chamados com filas, transferência entre setores e e-mails', 'concluido', 100, NULL, NULL, NULL, 'normal', true, 21),
  ('ficv-ate', 'Chamado aberto pela equipe para um aluno ou para a turma inteira', 'concluido', 100, NULL, NULL, NULL, 'normal', true, 22),
  ('ficv-ate', 'Avaliação do atendimento (NPS)', 'concluido', 100, NULL, NULL, NULL, 'normal', true, 23),
  ('ficv-ate', 'Tutor Virtual, a IA que responde os chamados dos alunos', 'concluido', 100, NULL, NULL, NULL, 'normal', true, 24),
  ('ficv-ate', 'Base de Conhecimento com busca por IA', 'concluido', 100, NULL, NULL, NULL, 'normal', true, 25),
  ('ficv-sec', 'Portal do Aluno: login por CPF, boletim e notas (Sponte e Moodle)', 'concluido', 100, NULL, NULL, NULL, 'normal', true, 26),
  ('ficv-sec', 'Portal instalável no celular (PWA) e banners de destaque', 'concluido', 100, NULL, NULL, NULL, 'normal', true, 27),
  ('ficv-sec', 'Espelho do Sponte: alunos, matrículas e turmas atualizados de hora em hora', 'concluido', 100, NULL, NULL, NULL, 'normal', true, 28),
  ('ficv-sec', 'Matrículas, turmas e histórico (só o que a FICV usa do Sponte)', 'planejado', 0, NULL, NULL, NULL, 'normal', false, 29),
  ('ficv-sec', 'Notas, boletim e frequência', 'planejado', 0, NULL, NULL, NULL, 'normal', false, 30),
  ('ficv-sec', 'Documentos automáticos (declarações e outros)', 'planejado', 0, NULL, NULL, NULL, 'normal', false, 31),
  ('ficv-fin', 'Financeiro no portal: parcelas ao vivo do Sponte', 'concluido', 100, NULL, NULL, NULL, 'normal', true, 32),
  ('ficv-fin', 'Painel de inadimplência por turma, com valores atualizados', 'concluido', 100, NULL, NULL, NULL, 'normal', true, 33),
  ('ficv-fin', 'Parcelas e segunda via no portal', 'planejado', 0, NULL, NULL, NULL, 'normal', false, 34),
  ('ficv-fin', 'Pagamento pelo meio de pagamento, com baixa automática', 'planejado', 0, NULL, NULL, NULL, 'normal', false, 35),
  ('ficv-fin', 'Demonstrativo anual para o Imposto de Renda no portal', 'planejado', 0, NULL, NULL, NULL, 'normal', false, 36),
  ('ficv-ava', 'Aulas e vídeos dentro do sistema (links do Vimeo)', 'planejado', 0, NULL, NULL, NULL, 'normal', false, 37),
  ('ficv-ava', 'Correção automática de provas objetivas', 'planejado', 0, NULL, NULL, NULL, 'normal', false, 38),
  ('ficv-ava', 'Correção de provas discursivas por IA, com revisão final do professor', 'planejado', 0, NULL, NULL, NULL, 'normal', false, 39),
  ('ficv-ava', 'Provas virtuais com agendamento, rastreamento e controle de ausência', 'planejado', 0, NULL, NULL, NULL, 'normal', false, 40),
  ('ficv-ava', 'Aulas assistidas: menos de 80% não conta como concluída', 'planejado', 0, NULL, NULL, NULL, 'normal', false, 41),
  ('ficv-ava', 'Trilhas de estudo recomendadas pela grade horária', 'planejado', 0, NULL, NULL, NULL, 'normal', false, 42),
  ('ficv-cpa', 'Formulário gamificado, com link público e dentro do Portal do aluno', 'concluido', 100, NULL, NULL, NULL, 'normal', true, 43),
  ('ficv-cpa', 'Painel de resultados com filtros e relatório de uma página por professor', 'concluido', 100, NULL, NULL, NULL, 'normal', true, 44),
  ('ficv-cpa', 'Verificação de integridade das respostas (cadeia de hash)', 'concluido', 100, NULL, NULL, NULL, 'normal', true, 45),
  ('ficv-com', 'Sistema próprio de envio de e-mails', 'planejado', 0, NULL, NULL, NULL, 'normal', false, 46),
  ('ficv-com', 'Eventos, inscrições e streaming de aulas e eventos ao vivo', 'planejado', 0, NULL, NULL, NULL, 'normal', false, 47),
  ('ficv-com', 'Calendário e agendamento próprio', 'planejado', 0, NULL, NULL, NULL, 'normal', false, 48),
  ('ficv-com', 'Novo site integrado, com formulários e rastreamento completo de acessos', 'planejado', 0, NULL, NULL, NULL, 'normal', false, 49),
  ('ficv-com', 'Atendimento unificado (WhatsApp, e-mail e redes sociais)', 'planejado', 0, NULL, NULL, NULL, 'normal', false, 50),
  ('ficv-doc', 'Assinatura eletrônica de contratos', 'planejado', 0, NULL, NULL, NULL, 'normal', false, 51),
  ('ficv-doc', 'Diploma pela B4: dados do contrato em JSON, enviados por API', 'planejado', 0, NULL, NULL, NULL, 'normal', false, 52),
  ('ficv-doc', 'Verificação de diplomas', 'planejado', 0, NULL, NULL, NULL, 'normal', false, 53),
  ('ficv-app', 'App na Apple App Store', 'planejado', 0, NULL, NULL, NULL, 'normal', false, 54),
  ('ficv-app', 'App na Play Store', 'planejado', 0, NULL, NULL, NULL, 'normal', false, 55),
  ('esc-mat', 'Cadastro e gerenciamento de matrículas', 'planejado', 0, NULL, NULL, NULL, 'normal', false, 56),
  ('esc-mat', 'Declaração de matrícula automática', 'planejado', 0, NULL, NULL, NULL, 'normal', false, 57),
  ('esc-fila', 'Gerenciamento da fila de espera', 'planejado', 0, NULL, NULL, NULL, 'normal', false, 58),
  ('esc-ate', 'Atendimento unificado (WhatsApp, e-mail e redes sociais)', 'planejado', 0, NULL, NULL, NULL, 'normal', false, 59),
  ('esc-ate', 'Agendamento próprio', 'planejado', 0, NULL, NULL, NULL, 'normal', false, 60),
  ('esc-ate', 'Documentos automáticos (declaração escolar etc.)', 'planejado', 0, NULL, NULL, NULL, 'normal', false, 61),
  ('esc-ger', 'Gestão de alunos e professores', 'planejado', 0, NULL, NULL, NULL, 'normal', false, 62),
  ('esc-ger', 'Diários de classe', 'planejado', 0, NULL, NULL, NULL, 'normal', false, 63),
  ('esc-ger', 'Portal do aluno e dos pais, com atividades online', 'planejado', 0, NULL, NULL, NULL, 'normal', false, 64),
  ('esc-fin', 'Financeiro das matrículas e mensalidades', 'planejado', 0, NULL, NULL, NULL, 'normal', false, 65),
  ('esc-fin', 'Pagamento pelo meio de pagamento', 'planejado', 0, NULL, NULL, NULL, 'normal', false, 66),
  ('esc-fin', 'Demonstrativo para o Imposto de Renda', 'planejado', 0, NULL, NULL, NULL, 'normal', false, 67),
  ('ger-fin', 'Entradas, saídas e conciliação bancária (Bradesco)', 'planejado', 0, NULL, NULL, NULL, 'normal', false, 68),
  ('ger-fin', 'Balancete e razão', 'planejado', 0, NULL, NULL, NULL, 'normal', false, 69),
  ('ger-fin', 'Repasses e movimentações entre sede e filiais', 'planejado', 0, NULL, NULL, NULL, 'normal', false, 70),
  ('ger-fin', 'Emissão de nota fiscal', 'planejado', 0, NULL, NULL, NULL, 'normal', false, 71),
  ('ger-fin', 'Integração com o meio de pagamento', 'planejado', 0, NULL, NULL, NULL, 'normal', false, 72),
  ('ger-com', 'Contas a pagar', 'planejado', 0, NULL, NULL, NULL, 'normal', false, 73),
  ('ger-com', 'Lançamentos por setor', 'planejado', 0, NULL, NULL, NULL, 'normal', false, 74),
  ('ger-com', 'Gestão de patrimônio', 'planejado', 0, NULL, NULL, NULL, 'normal', false, 75),
  ('ger-dad', 'Unir os dados dos sistemas da FICV e da Escola', 'planejado', 0, NULL, NULL, NULL, 'normal', false, 76),
  ('ger-dad', 'Relatórios avançados', 'planejado', 0, NULL, NULL, NULL, 'normal', false, 77);

INSERT INTO public.projeto_marcos (titulo, data, feito, ordem) VALUES
  ('Proposta fechada', '2026-11-04', true, 1),
  ('Painel de acompanhamento no ar', '2026-11-04', true, 2),
  ('Plano de migração para a AWS pronto', NULL, false, 3),
  ('Calendário de execução de cada módulo definido', NULL, false, 4),
  ('Fim do prazo de 15 meses', '2028-01-31', false, 5);

INSERT INTO public.projeto_registro (data, texto) VALUES
  ('2026-11-01', 'Início do projeto.'),
  ('2026-11-04', 'Proposta fechada.'),
  ('2026-11-04', 'Painel de acompanhamento publicado.'),
  ('2026-11-04', 'Funcionalidades que já existiam no sistema entram no painel como concluídas.');
