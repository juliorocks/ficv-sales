-- Assuntos "Acadêmico" e "Tutoria" viraram um só (pedido 28/09): fica "Acadêmico" (academico),
-- que já cai na fila de Tutoria do nível do curso. O valor 'tutoria' continua existindo no enum
-- (Postgres não remove valor de enum) mas fica sem uso: nada mais grava nem roteia por ele.
UPDATE tickets SET categoria = 'academico' WHERE categoria = 'tutoria';

UPDATE ticket_queues
   SET categorias = array_remove(categorias, 'tutoria'::ticket_categoria)
 WHERE 'tutoria'::ticket_categoria = ANY(categorias);

UPDATE ticket_queues SET categorias = array_append(categorias, 'academico'::ticket_categoria)
 WHERE nome IN ('Tutoria — Graduação', 'Tutoria — Pós-graduação') AND NOT ('academico'::ticket_categoria = ANY(categorias));
