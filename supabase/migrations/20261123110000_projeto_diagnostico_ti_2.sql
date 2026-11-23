-- Painel do Projeto: 2ª leva do diagnóstico do TI (Faculdade com Pedagógico em 17/11, Escola com Patrimônio em 18/11,
-- Financeiro com Contas a Receber e wishlist de pagamentos) e virada da AWS remarcada para 01/12/2026.
-- Idempotente: frente por id, tarefa por (frente_id, titulo).

-- Virada da AWS: 20/11 -> 01/12
UPDATE public.projeto_frentes SET fim = '2026-12-01' WHERE id = 'aws';
UPDATE public.projeto_tarefas SET inicio = '2026-12-01', fim = '2026-12-01'
 WHERE frente_id = 'aws' AND titulo = 'Testes em paralelo, virada e plano de volta';
UPDATE public.projeto_marcos SET data = '2026-12-01' WHERE titulo = 'Migração para a AWS (virada)';

-- Frentes: Financeiro e Patrimônio ganham frentes próprias; polos EAD entra como frente da FICV
UPDATE public.projeto_frentes SET nome = 'Compras e suprimentos',
       descricao = 'Requisição, cotação, alçadas, ordem de compra e entrada pelo XML da NF-e.'
 WHERE id = 'ger-com';

INSERT INTO public.projeto_frentes (id, sistema, nome, descricao, ordem) VALUES
  ('ger-rec',  'gerencial', 'Contas a receber', 'Créditos, devoluções, conciliação, notas em lote, segunda via e regras de desconto (levantamento do Financeiro).', 27),
  ('ger-ban',  'gerencial', 'Bancos e contas a pagar', 'Painel de pagamentos do dia, DDA, cartões corporativos, encargos, repasses e documentos pendentes.', 28),
  ('ger-pat',  'gerencial', 'Patrimônio e almoxarifado', 'Bens, placas, baixa patrimonial, depreciação, etiquetas e estoque. Parte do que o app Aquila faz hoje.', 29),
  ('ficv-polo','ficv',      'Polos EAD', 'Portal de gestão para cada polo, com acesso só aos alunos vinculados a ele.', 30)
ON CONFLICT (id) DO NOTHING;

UPDATE public.projeto_tarefas SET frente_id = 'ger-pat'
 WHERE frente_id = 'ger-com'
   AND titulo IN ('Gestão de patrimônio', 'Patrimônio: manutenção, garantia e depreciação',
                  'Patrimônio: tombamento com QR Code, localização e termo de transferência',
                  'Almoxarifado com estoque mínimo e inventário');

-- Diagnóstico: o que chegou e o que falta
UPDATE public.projeto_tarefas
   SET titulo = 'Diagnóstico: faltam Compras, Espaços e TI nas duas versões, o Pedagógico da Escola e o Patrimônio da Faculdade (só com o nome do responsável)'
 WHERE frente_id = 'gestao' AND titulo LIKE 'Diagnóstico: Financeiro, Compras%';

WITH novas(frente_id, titulo, prioridade, feita) AS (VALUES
  ('gestao', 'Diagnóstico do TI: Faculdade, Pedagógico preenchido em 17/11 (Victor Grisi), com CPA, AVA, Portal do Aluno e Portal dos Polos EAD', 'normal', true),
  ('gestao', 'Diagnóstico do TI: Escola, Patrimônio e Almoxarifado preenchido em 18/11 (Felinto Monteiro)', 'normal', true),
  ('gestao', 'Diagnóstico do TI: levantamento do Financeiro (Contas a Receber, 10 processos) e sugestões de pagamentos e fiscal anexados', 'normal', true),

  ('ficv-polo', 'Cadastro dos polos e vínculo de cada aluno ao seu polo', 'normal', false),
  ('ficv-polo', 'Portal do polo: cada polo vê só os alunos dele', 'normal', false),
  ('ficv-polo', 'Acesso do polo limitado a informações pedagógicas e financeiras', 'normal', false),

  ('ger-rec', 'Transferência entre contas (Caixa, Bradesco, Stone, Pagar.me, Prover) como movimentação interna, sem gerar receita nem despesa', 'normal', false),
  ('ger-rec', 'Pagamento em duplicidade vira crédito do aluno, em destaque no financeiro', 'normal', false),
  ('ger-rec', 'Crédito do aluno: usar em outra parcela ou devolver, com rastreio da origem ao uso', 'normal', false),
  ('ger-rec', 'Devolução integral e parcial (valor bruto, multa retida e líquido) por Pix, transferência e cartão', 'normal', false),
  ('ger-rec', 'Devolução gera a obrigação no Contas a Pagar, vinculada ao responsável e ao aluno', 'normal', false),
  ('ger-rec', 'Estorno de cartão à vista e parcelado, com baixa mensal do crédito', 'normal', false),
  ('ger-rec', 'Nota fiscal em um único processamento por período e competência, sem limite de 100, com relatório de inconsistências', 'normal', false),
  ('ger-rec', 'Conciliação de extrato: tela dividida entre extrato e lançamentos, ajuste de centavos e histórico', 'normal', false),
  ('ger-rec', 'Conciliação de cartão: importar o CSV da operadora, baixar sozinho e listar divergências', 'normal', false),
  ('ger-rec', 'Trava contra reimportar o mesmo arquivo ou baixar a mesma transação duas vezes', 'alta', false),
  ('ger-rec', 'Financeiro do aluno com todas as parcelas: valor original, desconto, percentual, líquido, data de pagamento e situação', 'normal', false),
  ('ger-rec', 'Histórico por parcela: desconto incluído após o vencimento, mudança de desconto, estornos e cancelamentos', 'normal', false),
  ('ger-rec', 'Segunda via de boleto e Pix pelo responsável, com juros, multa e estorno do desconto após o vencimento', 'normal', false),
  ('ger-rec', 'Emissão de boleto e link pela equipe direto na tela do Contas a Receber do aluno', 'normal', false),
  ('ger-rec', 'Tolerância de atraso uma vez por ano por aluno, com desconto mantido mediante justificativa', 'normal', false),
  ('ger-rec', 'Aluno funcionário da pós: desconto mantido após o vencimento e sem link de pagamento automático', 'normal', false),
  ('ger-rec', 'Um único desconto por aluno: majorar substitui o anterior, não soma bolsas', 'normal', false),

  ('ger-ban', 'Painel integrado de pagamentos do dia, por instituição e conta bancária', 'normal', false),
  ('ger-ban', 'Consulta de saldos das contas da Fundação, Escola e Faculdade, individual e consolidada', 'normal', false),
  ('ger-ban', 'Conciliação dos boletos do DDA com títulos, notas e compras, com alerta de não reconhecidos', 'normal', false),
  ('ger-ban', 'Despesa vinculada a quem solicitou e comprou, com o histórico da solicitação', 'normal', false),
  ('ger-ban', 'Documentos pendentes cobrados dos responsáveis, com prazo e notificação', 'normal', false),
  ('ger-ban', 'Importação automática de notas, boletos e faturas recebidos por e-mail', 'normal', false),
  ('ger-ban', 'Consulta de documentos em portais de fornecedores', 'normal', false),
  ('ger-ban', 'Documentos financeiros organizados por instituição, mês e situação, com Google Drive', 'normal', false),
  ('ger-ban', 'Cartões corporativos: importar fatura em PDF, conciliar e baixar compras e parcelas', 'normal', false),
  ('ger-ban', 'Baixas em lote com centro de custo, sugestão automática e rateio', 'normal', false),
  ('ger-ban', 'Tarifas de Pix, boleto e bancárias lançadas a partir do extrato', 'normal', false),
  ('ger-ban', 'Transferência entre contas e entre CNPJs com os dois movimentos e sem duplicar', 'normal', false),
  ('ger-ban', 'Pagamento centralizado pela conta da Fundação, preservando a instituição de origem', 'normal', false),
  ('ger-ban', 'Encargos da folha (INSS, IRRF, PIS) viram títulos por instituição e competência', 'normal', false),
  ('ger-ban', 'Tributos retidos de terceiros ligados às notas e às obrigações de recolhimento', 'normal', false),
  ('ger-ban', 'Guias consolidadas (DARF) com rateio entre instituições e conferência dos valores', 'normal', false),
  ('ger-ban', 'Previsão dos repasses de Escola e Faculdade para a Fundação', 'normal', false),
  ('ger-ban', 'Baixa e arquivamento do pagamento confirmado pelo banco, com o comprovante', 'normal', false),
  ('ger-ban', 'Painel de pendências financeiras com responsável e situação', 'normal', false),

  ('ger-pat', 'Cadastro de bens com placa automática (empresa, categoria e sequência de 6 dígitos) e uma placa por unidade', 'normal', false),
  ('ger-pat', 'Cadastro pela nota fiscal: XML da NF-e, PDF ou foto com OCR e conferência antes de gravar', 'normal', false),
  ('ger-pat', 'Busca única, leitor de código de barras e edição em massa', 'normal', false),
  ('ger-pat', 'Etiquetas de patrimônio com código de barras Code 128', 'normal', false),
  ('ger-pat', 'Depreciação linear e vida útil por categoria, com bens vencidos ou vencendo em 12 meses', 'normal', false),
  ('ger-pat', 'Baixa patrimonial em três etapas: solicitação, autorização da Diretoria e termo em PDF', 'normal', false),
  ('ger-pat', 'Baixa por motivo (descarte, venda, furto, sinistro, doação) com documentos obrigatórios', 'normal', false),
  ('ger-pat', 'Termos de baixa e de doação em PDF, com código de verificação e assinaturas por tipo de empresa', 'normal', false),
  ('ger-pat', 'Patrimônio das cinco entidades: Fundação, Academy, Faculdade, Igreja e Livraria Sementes', 'normal', false),
  ('ger-pat', 'Painel de saúde patrimonial, nota de 0 a 100, com pendências clicáveis e relatório', 'normal', false),
  ('ger-pat', 'Perfis e permissões do patrimônio (Administrador, Diretoria, Operador e Consulta) com histórico', 'normal', false),
  ('ger-pat', 'Importar a planilha "Ativos FCV" do app Aquila preservando as placas existentes', 'alta', false),
  ('ger-pat', 'Almoxarifado: entrada de produtos por código ou nome, com nota fiscal e localização', 'normal', false),
  ('ger-pat', 'Etiquetas do almoxarifado 70x30 mm (Zebra ZD220): produto, prateleira, empréstimo e reintegração', 'normal', false),
  ('ger-pat', 'Produto com localização, estoque mínimo e máximo, criticidade e ponto de pedido automático', 'normal', false)
)
INSERT INTO public.projeto_tarefas (frente_id, titulo, status, progresso, prioridade, previo, ordem, concluido_em)
SELECT n.frente_id, n.titulo,
       CASE WHEN n.feita THEN 'concluido' ELSE 'planejado' END,
       CASE WHEN n.feita THEN 100 ELSE 0 END,
       n.prioridade, false,
       (SELECT coalesce(max(ordem), 0) FROM public.projeto_tarefas) + row_number() OVER (),
       CASE WHEN n.feita THEN DATE '2026-11-23' END
  FROM novas n
 WHERE NOT EXISTS (SELECT 1 FROM public.projeto_tarefas t WHERE t.frente_id = n.frente_id AND t.titulo = n.titulo);

INSERT INTO public.projeto_registro (data, texto)
SELECT '2026-11-23', 'Virada para a AWS remarcada de 20/11 para 01/12/2026.'
 WHERE NOT EXISTS (SELECT 1 FROM public.projeto_registro WHERE texto LIKE 'Virada para a AWS remarcada%');
INSERT INTO public.projeto_registro (data, texto)
SELECT '2026-11-23', 'Novos documentos do TI incorporados: Pedagógico da Faculdade, Patrimônio da Escola e levantamento do Financeiro. 4 frentes novas (Contas a receber, Bancos e contas a pagar, Patrimônio e almoxarifado, Polos EAD).'
 WHERE NOT EXISTS (SELECT 1 FROM public.projeto_registro WHERE texto LIKE 'Novos documentos do TI incorporados%');
