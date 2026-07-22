-- "Isabelly Souza" é a mesma pessoa que "Izabelly Souza" (confirmado) —
-- padroniza pra grafia correta. Afeta o dashboard de qualidade/ranking de
-- agentes e o cruzamento de matrículas por agente (ambos usam agent_name).
UPDATE messages_logs
SET agent_name = 'Izabelly Souza'
WHERE agent_name = 'Isabelly Souza';
