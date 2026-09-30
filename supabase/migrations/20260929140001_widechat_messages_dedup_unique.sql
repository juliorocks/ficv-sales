-- Achado ao vivo (29/09): a checagem de duplicado do vivaconnect-webhook é "olhar antes,
-- gravar depois" (SELECT no início da função, INSERT só perto do fim, depois de vários
-- awaits — lead lookup, reabertura, IA...). Z-PRO reenvia o webhook se a resposta demorar
-- (e ela demora: a função só responde depois da IA terminar, que pode levar vários
-- segundos) — a 2ª entrega passa pela checagem ANTES da 1ª terminar de gravar, e as duas
-- acabam chamando a IA e mandando a MESMA resposta duas vezes pro cliente (reproduzido:
-- aviso de handoff duplicado, mesmo minuto, texto idêntico).
-- Trava de verdade: unique no banco, só pro provider 'vivaconnect' (índice PARCIAL — o
-- provider 'widechat', legado, já tinha duplicidade histórica de (provider, message_id)
-- de antes de existir checagem nenhuma; um UNIQUE cobrindo a tabela inteira falhava ao
-- criar por causa disso — não é o provider que este achado investiga, não mexo nele).
-- NULL em message_id não colide entre si (comportamento padrão do Postgres em índice
-- único), então mensagens sem id (alguns tipos de payload) não são afetadas.
CREATE UNIQUE INDEX IF NOT EXISTS widechat_messages_vivaconnect_message_id_key
  ON widechat_messages (message_id) WHERE provider = 'vivaconnect';
