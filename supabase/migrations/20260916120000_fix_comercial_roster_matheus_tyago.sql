-- Bug: leads não estavam sendo finalizados. Causa raiz: Matheus Marcelino (910
-- msgs/10d) e Tyago Mendes (400 msgs/10d) — dois agentes reais e muito ativos —
-- nunca foram vinculados ao time "Comercial" em agent_team (existem em
-- agent_profiles desde 05/2026 e 03/2026, mas com team_id NULL). O webhook do
-- Widechat trata qualquer agente fora do roster Comercial como "setor não
-- comercial", bloqueia o telefone permanentemente em widechat_blocklist_contacts
-- e a partir daí ignora TODO webhook seguinte daquele contato — inclusive o
-- evento de "atendimento finalizado", travando o lead pra sempre em
-- Entrada/Em Contato. 128 telefones (74 do Matheus + 54 do Tyago) foram
-- bloqueados assim; pelo menos 32 leads deles seguem ativos e nunca finalizam.

insert into agent_team (agent_id, team_id)
values
    ('ad75dbcb-023f-4211-b230-123bf8396fcc', '1db9a052-1f13-443f-bf91-e86f1d58bf46'), -- Matheus Marcelino
    ('b76d7799-f821-4843-bfb2-e8ce7a18fcba', '1db9a052-1f13-443f-bf91-e86f1d58bf46')  -- Tyago Mendes
on conflict do nothing;

-- Remove os bloqueios indevidos: motivo é sempre o agentName exato que gerou o
-- bloqueio, então "Matheus Marcelino"/"Tyago" só existem aqui por causa desse bug.
delete from widechat_blocklist_contacts where motivo in ('Matheus Marcelino', 'Tyago');
