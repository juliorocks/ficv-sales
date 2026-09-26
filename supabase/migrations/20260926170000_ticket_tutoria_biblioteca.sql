-- Portal do Aluno: novos assuntos de chamado "Tutoria" e "Biblioteca" (pedido 26/09).
-- Tutoria vai pra fila de tutoria do NÍVEL do curso que o aluno marcar (graduação → Tutoria —
-- Graduação; pós → Tutoria — Pós-graduação) — o nível sai do curso (ticket_set_queue/ticket_route).
-- Biblioteca ganha fila própria (todos os níveis), pra cadastrar a bibliotecária como membro.
-- (ADD VALUE não pode ser usado na mesma transação: rodar com psql -f, sem BEGIN.)
ALTER TYPE ticket_categoria ADD VALUE IF NOT EXISTS 'tutoria';
ALTER TYPE ticket_categoria ADD VALUE IF NOT EXISTS 'biblioteca';

UPDATE ticket_queues SET categorias = array_append(categorias, 'tutoria')
 WHERE nome IN ('Tutoria — Graduação', 'Tutoria — Pós-graduação') AND NOT ('tutoria' = ANY(categorias));

INSERT INTO ticket_queues (nome, nivel, categorias, padrao, ativo, ordem)
SELECT 'Biblioteca', 'todos', ARRAY['biblioteca']::ticket_categoria[], false, true, 4
 WHERE NOT EXISTS (SELECT 1 FROM ticket_queues WHERE nome = 'Biblioteca');
