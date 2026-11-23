-- Painel do Projeto: demandas do diagnóstico do TI (Escola em 09/11, Faculdade em 16/11) viram frentes e tarefas.
-- Idempotente: frente por id, tarefa por (frente_id, titulo).

INSERT INTO public.projeto_frentes (id, sistema, nome, descricao, ordem) VALUES
  ('integra',   'projeto',   'Integrações e infraestrutura (TI)', 'Pagar.me, bancos, Moodle, WhatsApp, assinatura digital, INEP, BI e segurança.', 20),
  ('ficv-ped',  'ficv',      'Pedagógico (Faculdade)', 'TCC, estágios, horas complementares, mural e aplicativo.', 21),
  ('esc-sec',   'escola',    'Secretaria escolar', 'Transferências, dossiê, bolsas, devoluções, censo e relação com a Secretaria de Educação.', 22),
  ('esc-ped',   'escola',    'Pedagógico (Escola)', 'Ocorrências e comunicação com as famílias.', 23),
  ('ger-fisc',  'gerencial', 'Fiscal e tributos', 'Notas fiscais recebidas e emitidas, portais fiscais, competência e tributos por CNPJ.', 24),
  ('ger-ctb',   'gerencial', 'Contabilidade e controles', 'Contabilidade por CNPJ, DRE, documentos, duplicidades, fechamento mensal e auditoria.', 25),
  ('ger-esp',   'gerencial', 'Espaços e recursos', 'Reserva de salas, equipamentos e agendamento de atendimentos.', 26)
ON CONFLICT (id) DO NOTHING;

WITH novas(frente_id, titulo, prioridade) AS (VALUES
  ('gestao', 'Diagnóstico de demandas recebido do TI: Escola, Secretaria preenchida em 09/11', 'normal'),
  ('gestao', 'Diagnóstico de demandas recebido do TI: Faculdade, Secretaria preenchida em 16/11', 'normal'),
  ('gestao', 'Diagnóstico: Financeiro, Compras, Patrimônio, Espaços, Pedagógico e TI ainda em branco nas duas versões, falta o responsável de cada setor preencher', 'alta'),
  ('gestao', 'Transformar o diagnóstico em calendário por módulo, com a equipe de implementação', 'alta'),

  ('integra', 'Pagar.me: cartão de crédito recorrente, com vários cartões e tokenização', 'normal'),
  ('integra', 'Pagar.me: Pix dinâmico com baixa automática por webhook', 'normal'),
  ('integra', 'Pagar.me: boleto registrado com Pix no mesmo documento', 'normal'),
  ('integra', 'Pagar.me: split de pagamentos entre unidades e parceiros', 'normal'),
  ('integra', 'Pagar.me: antifraude, chargeback e estornos', 'normal'),
  ('integra', 'Bancos: leitura automática de extrato por API (Open Finance ou API direta)', 'normal'),
  ('integra', 'Bancos: conciliação automática e baixa por NSU ou ID da transação', 'normal'),
  ('integra', 'Bancos: arquivos CNAB 240/400 como contingência', 'normal'),
  ('integra', 'Bancos: saldos e extratos de todas as contas em um só painel', 'normal'),
  ('integra', 'Moodle: sincronização de turmas, alunos e notas nos dois sentidos', 'normal'),
  ('integra', 'Controle de acesso: catracas e biometria liberadas pela situação da matrícula', 'normal'),
  ('integra', 'WhatsApp oficial: envio automático de boletos, lembretes e avisos', 'normal'),
  ('integra', 'INEP e e-MEC: exportação e importação no layout oficial', 'normal'),
  ('integra', 'BI: acesso seguro aos dados pelo Power BI ou Metabase', 'normal'),
  ('integra', 'Segurança: OAuth2 e JWT para aplicativo e integrações', 'normal'),
  ('integra', 'Segurança: limite de requisições e trilha de logs de todas as chamadas', 'normal'),
  ('integra', 'Segurança: LGPD, criptografia em trânsito e em repouso', 'normal'),

  ('ficv-sec', 'Matrícula e rematrícula por período: vestibular, ENEM, transferência, portador de diploma e reingresso', 'normal'),
  ('ficv-sec', 'Vagas por curso, turno e modalidade (presencial ou EAD)', 'normal'),
  ('ficv-sec', 'Situação da matrícula atualizada sozinha: ativa, trancada, cancelada ou formada', 'normal'),
  ('ficv-sec', 'Documentos obrigatórios da matrícula e pendências', 'normal'),
  ('ficv-sec', 'Devoluções de pagamentos, com acompanhamento junto ao Financeiro', 'normal'),
  ('ficv-sec', 'Recebimento de pagamentos diversos (taxas, multas de biblioteca, extensão)', 'normal'),
  ('ficv-sec', 'Censo da Educação Superior (INEP): coleta, validação e retificação', 'normal'),
  ('ficv-ate', 'Atendimento por assunto, com prazo e encaminhamento entre Coordenação, Financeiro, Registro e CPA', 'normal'),
  ('ficv-doc', 'Colação de grau ordinária e especial, com conferência de requisitos de conclusão', 'normal'),
  ('ficv-doc', 'Histórico, declarações, ementas e certificados com código e QR Code de validação', 'normal'),
  ('ficv-ped', 'TCC: orientações e bancas examinadoras', 'normal'),
  ('ficv-ped', 'Estágio supervisionado: convênios e horas complementares', 'normal'),
  ('ficv-ped', 'Mural de avisos, notificações no aplicativo e calendário de provas', 'normal'),

  ('esc-mat', 'Vagas por turma e turno, e rematrícula por período', 'normal'),
  ('esc-mat', 'Documentos obrigatórios da matrícula e pendências', 'normal'),
  ('esc-mat', 'Contrato com assinatura eletrônica e situação da matrícula atualizada sozinha', 'normal'),
  ('esc-fila', 'Classificação cronológica com critérios de prioridade', 'normal'),
  ('esc-fila', 'Convocação com prazo de resposta, aceite ou desistência, e histórico', 'normal'),
  ('esc-fila', 'Candidato aceito vira matrícula sem digitar de novo', 'normal'),
  ('esc-ate', 'Registro único de atendimentos (presencial, telefone, WhatsApp e e-mail) com prazo e encaminhamento entre setores', 'normal'),
  ('esc-ate', 'Suporte aos setores: coordenadores, professores e Direção', 'normal'),
  ('esc-sec', 'Transferências escolares: orientação, documentos e emissão', 'normal'),
  ('esc-sec', 'Dossiê digital do aluno, com documentos obrigatórios por etapa e validade', 'normal'),
  ('esc-sec', 'Descontos e bolsas: solicitação, análise e aplicação no financeiro', 'normal'),
  ('esc-sec', 'Autorizações de saída e retirada de alunos por terceiros', 'normal'),
  ('esc-sec', 'Devoluções de pagamentos (matrícula, oficinas, material, mensalidade a maior)', 'normal'),
  ('esc-sec', 'Recebimento de pagamentos diversos (aula de campo, formatura ABC, biblioteca)', 'normal'),
  ('esc-sec', 'Indicadores escolares por turma, etapa, turno e ano letivo', 'normal'),
  ('esc-sec', 'Censo Escolar: coleta, validação e retificação', 'normal'),
  ('esc-sec', 'Processos junto à Secretaria de Educação: Regimento, Matriz Curricular e PPP', 'normal'),
  ('esc-ped', 'Ocorrências acadêmicas, disciplinares e de saúde, com aviso aos responsáveis', 'normal'),
  ('esc-ped', 'Mural, notificações no aplicativo, calendário de provas e pesquisa de satisfação', 'normal'),

  ('ger-fin', 'Faturamento em lote: carnês, taxas, dependências e cursos livres', 'normal'),
  ('ger-fin', 'Descontos e bolsas: pontualidade, convênio, indicação, FIES e PROUNI', 'normal'),
  ('ger-fin', 'Régua de cobrança por e-mail e SMS e portal de renegociação', 'normal'),
  ('ger-fin', 'Faturamento e histórico por unidade (Fundação, Escola e Faculdade), individual e consolidado', 'normal'),
  ('ger-fin', 'Receitas por competência e receitas extraordinárias (eventos, cursos livres, taxas)', 'normal'),
  ('ger-fisc', 'Notas fiscais recebidas contra os CNPJs, capturadas automaticamente', 'normal'),
  ('ger-fisc', 'Portal Nacional da NFS-e e sistemas municipais', 'normal'),
  ('ger-fisc', 'Conciliação de notas: ERP, Portal Nacional e livros fiscais', 'normal'),
  ('ger-fisc', 'Notas emitidas pela Escola e Faculdade contra o faturamento e as Prefeituras', 'normal'),
  ('ger-fisc', 'Competência fiscal e situação das notas (canceladas, substituídas, rejeitadas)', 'normal'),
  ('ger-fisc', 'Apuração de ISS, PIS, COFINS, IRPJ e CSLL por CNPJ', 'normal'),
  ('ger-fisc', 'Conciliação de tributos: folha, relatórios fiscais e guias', 'normal'),
  ('ger-ctb', 'Contabilidade por CNPJ (Fundação, Escola e Faculdade) e consolidação', 'normal'),
  ('ger-ctb', 'DRE gerencial por unidade e centro de custo', 'normal'),
  ('ger-ctb', 'Integração com a folha de pagamento', 'normal'),
  ('ger-ctb', 'Leitura de PDFs por OCR e vínculo entre nota, boleto e comprovante', 'normal'),
  ('ger-ctb', 'Duplicidades, documentos pendentes e conferência de favorecidos', 'normal'),
  ('ger-ctb', 'Classificação automática de despesas e de movimentações bancárias', 'normal'),
  ('ger-ctb', 'Aplicações financeiras e transferências entre CNPJs da instituição', 'normal'),
  ('ger-ctb', 'Documentos centralizados por CNPJ, com pesquisa inteligente', 'normal'),
  ('ger-ctb', 'Checklist de fechamento mensal e painel de pendências', 'normal'),
  ('ger-ctb', 'Rastreabilidade, histórico de alterações e permissões por unidade', 'normal'),
  ('ger-ctb', 'Alertas de anomalias, inconsistências e variações', 'normal'),
  ('ger-com', 'Requisição interna de compras, com centro de custo', 'normal'),
  ('ger-com', 'Cotações com mapa comparativo de ao menos 3 propostas', 'normal'),
  ('ger-com', 'Alçadas de aprovação por valor', 'normal'),
  ('ger-com', 'Ordem de compra, conferência no recebimento e entrada pelo XML da NF-e', 'normal'),
  ('ger-com', 'Almoxarifado com estoque mínimo e inventário', 'normal'),
  ('ger-com', 'Patrimônio: tombamento com QR Code, localização e termo de transferência', 'normal'),
  ('ger-com', 'Patrimônio: manutenção, garantia e depreciação', 'normal'),
  ('ger-esp', 'Reserva de salas, laboratórios, auditórios e quadras', 'normal'),
  ('ger-esp', 'Reserva e retirada de equipamentos e veículos', 'normal'),
  ('ger-esp', 'Agendamento de atendimentos (Coordenação, Psicologia, DAE e Financeiro)', 'normal'),
  ('ger-esp', 'Bloqueio de choque de horário, limite de horas e aprovação', 'normal')
)
INSERT INTO public.projeto_tarefas (frente_id, titulo, status, progresso, prioridade, previo, ordem, concluido_em)
SELECT n.frente_id, n.titulo,
       CASE WHEN n.titulo LIKE 'Diagnóstico de demandas recebido%' THEN 'concluido'
            WHEN n.titulo LIKE 'Diagnóstico: Financeiro%' THEN 'andamento' ELSE 'planejado' END,
       CASE WHEN n.titulo LIKE 'Diagnóstico de demandas recebido%' THEN 100 ELSE 0 END,
       n.prioridade, false,
       (SELECT coalesce(max(ordem), 0) FROM public.projeto_tarefas) + row_number() OVER (),
       CASE WHEN n.titulo LIKE 'Diagnóstico de demandas recebido%' THEN DATE '2026-11-17' END
  FROM novas n
 WHERE NOT EXISTS (SELECT 1 FROM public.projeto_tarefas t WHERE t.frente_id = n.frente_id AND t.titulo = n.titulo);

-- Migração para a AWS: virada prevista para 20/11/2026
UPDATE public.projeto_frentes SET inicio = '2026-11-17', fim = '2026-11-20' WHERE id = 'aws' AND fim IS NULL;
UPDATE public.projeto_tarefas SET inicio = '2026-11-20', fim = '2026-11-20', prioridade = 'alta'
 WHERE frente_id = 'aws' AND titulo = 'Testes em paralelo, virada e plano de volta' AND fim IS NULL;
INSERT INTO public.projeto_marcos (titulo, data, feito, ordem)
SELECT 'Migração para a AWS (virada)', '2026-11-20', false, 6
 WHERE NOT EXISTS (SELECT 1 FROM public.projeto_marcos WHERE titulo = 'Migração para a AWS (virada)');

INSERT INTO public.projeto_registro (data, texto)
SELECT '2026-11-17', 'Diagnóstico do TI (Escola e Faculdade) incorporado ao painel: 7 frentes novas e as demandas dos setores como tarefas. Virada para a AWS marcada para 20/11.'
 WHERE NOT EXISTS (SELECT 1 FROM public.projeto_registro WHERE texto LIKE 'Diagnóstico do TI%');
