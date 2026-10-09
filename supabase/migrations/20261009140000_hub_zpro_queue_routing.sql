-- Hub do Grupo: 2º modo de encaminhamento, além do "número novo" que já existe.
-- Pedido do usuário 09/10: o número oficial (3041-7471) vai virar o único número tanto da
-- Faculdade quanto da Igreja — a Igreja não vai ganhar número próprio, vai atender direto
-- pelo PAINEL DO Z-PRO, numa fila própria de lá (confirmada via API: listQueues → id 3 =
-- "IGREJA", já existe no tenant). zpro_queue_id preenchido = destino usa esse modo (ignora
-- numero/mensagem_redirect/canal da empresa, que continuam servindo os destinos que ainda
-- vão ganhar número novo, como Escola/Fundação).
ALTER TABLE vivaconnect_hub_destinations ADD COLUMN IF NOT EXISTS zpro_queue_id integer;
ALTER TABLE vivaconnect_hub_destinations ADD COLUMN IF NOT EXISTS mensagem_fila text NOT NULL DEFAULT
  'Que bom que você quer falar com a {empresa}! 💙 Já encaminhei você pra nossa equipe por aqui mesmo — só um instante que já te atendemos.';

UPDATE vivaconnect_hub_destinations SET zpro_queue_id = 3, updated_at = now()
  WHERE nome ILIKE '%igreja%' AND zpro_queue_id IS NULL;
