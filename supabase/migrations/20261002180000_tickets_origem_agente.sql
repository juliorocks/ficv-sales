-- Pedido do usuário 02/10: agente/equipe abre chamado em nome de um aluno (ou turma inteira) —
-- precisa de um `origem` próprio (nem 'portal' — o aluno não abriu sozinho — nem 'transferencia'
-- — não veio de um lead do Comercial) pra dar pra distinguir depois nos relatórios.
ALTER TABLE tickets DROP CONSTRAINT tickets_origem_check;
ALTER TABLE tickets ADD CONSTRAINT tickets_origem_check
  CHECK (origem = ANY (ARRAY['portal'::text, 'transferencia'::text, 'email'::text, 'agente'::text]));
