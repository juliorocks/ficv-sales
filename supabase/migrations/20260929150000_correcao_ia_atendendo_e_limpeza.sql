-- 29/09, pedido do usuário — duas correções de dados no Funil de Leads:
--
-- 1) "IA Atendendo" tinha 213 leads que NUNCA passaram pela IA de verdade: um UPDATE em
--    massa (fora do fluxo normal, não rastreado em migration nenhuma) moveu todos pra
--    stage_id=9 às 12:17 de hoje, no mesmo minuto — nenhum tem ai_lead_sessions, nenhum é
--    do VivaConnect. Volta cada um pro lugar mais coerente com o que já se sabia dele:
--    quem tinha agente atribuído → Em Contato (é onde esse estado normalmente mora); sem
--    agente → Entrada. stage_entry_date não é tocado (preserva o histórico real).
--
-- 2) Limpeza: leads que entraram antes de julho/2026 e nunca saíram do funil ativo
--    (Entrada/Em Contato/IA Atendendo) viram Finalizado. NÃO toca em Matriculado/Perdido/
--    Finalizado já existentes — só tira do funil ativo quem está parado há meses.

UPDATE leads
   SET stage_id = CASE WHEN assigned_to_id IS NOT NULL THEN 2 ELSE 1 END,
       updated_at = now()
 WHERE stage_id = 9;

UPDATE leads
   SET stage_id = 8, stage_entry_date = now(), updated_at = now()
 WHERE data_entrada < '2026-07-01'
   AND stage_id IN (1, 2, 9);
