-- Confete de nova matrícula (pedido do usuário 08/10): o front escuta INSERT em lead_history
-- com to_stage_id = Matriculado pra comemorar ao vivo quando sync_leads_matriculado_from_sponte
-- (cron) confirma uma matrícula — essa tabela só recebe linha de rotinas automáticas, nunca de
-- edição manual no Kanban, então é o sinal exato pedido ("a cada verificação de nova matrícula
-- no Sponte"). Precisa estar na publicação do Realtime pra disparar postgres_changes.
ALTER PUBLICATION supabase_realtime ADD TABLE lead_history;
