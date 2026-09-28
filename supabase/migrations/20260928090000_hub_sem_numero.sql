-- Hub (28/09): empresa do grupo entra na triagem mesmo SEM número novo — a IA sempre
-- classifica (quem pergunta de membresia nunca vira lead da Faculdade). Sem número, a pessoa
-- recebe esta mensagem em vez do número novo.
ALTER TABLE vivaconnect_hub_destinations ADD COLUMN IF NOT EXISTS mensagem_sem_numero text NOT NULL DEFAULT
  E'Olá{nome_virgula}! 💙 Este WhatsApp agora é exclusivo da *Faculdade Internacional Cidade Viva*.\nO atendimento da *{empresa}* está mudando de número — por favor, procure a {empresa} pelos canais oficiais (site e Instagram). Obrigado pela compreensão!';
-- Igreja, Escola e Fundação passam a participar da triagem já; Education continua desligada
-- até alguém descrever os assuntos dela (o texto atual é só exemplo e poderia puxar EAD da Faculdade).
UPDATE vivaconnect_hub_destinations SET ativo = true WHERE nome IN ('Igreja Cidade Viva', 'Escola Cidade Viva', 'Fundação Cidade Viva');
UPDATE vivaconnect_hub_destinations SET assuntos =
  'Faculdade / ensino SUPERIOR: vestibular, processo seletivo, graduação (Teologia EAD/presencial, Direito), pós-graduação e especializações, cursos da faculdade, valores e mensalidade da faculdade, bolsas e descontos da faculdade, matrícula de adulto em curso superior, alunos e ex-alunos da faculdade, portal do aluno, notas, diploma, certificado, secretaria acadêmica, tutoria, biblioteca. A faculdade tem ALUNOS (não tem membros).'
 WHERE is_self;
UPDATE vivaconnect_hub_destinations SET assuntos =
  'Igreja: como se tornar MEMBRO, membresia, batismo, cultos e horários de culto, células/pequenos grupos, pastores, aconselhamento pastoral, pedidos de oração, casamento na igreja, apresentação de crianças, ministérios, voluntariado na igreja, dízimos e ofertas, eventos, retiros e conferências da igreja, visitar a igreja, endereço da igreja.'
 WHERE nome = 'Igreja Cidade Viva';
