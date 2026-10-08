-- Backfill dos 312 leads que a versão antiga de finalize_stale_widechat_leads() (ver
-- 20261008130000_stale_24h_assigned_goes_em_contato.sql) já tinha empurrado errado pra
-- Entrada mesmo com agente atribuído, desde 29/09 (quando o backfill pontual daquele dia
-- corrigiu só os casos até então, sem corrigir a função). Pedido do usuário 08/10, confirmado
-- explicitamente antes de rodar (muda a coluna de vários agentes de uma vez no Kanban).
-- Mesmo critério da função corrigida: tem agente, está em Entrada, última mensagem (não do
-- cliente) há 24h+.
DO $$
declare
    v_entrada_id integer;
    v_em_contato_id integer;
    v_count integer := 0;
    r record;
begin
    select id into v_entrada_id from stages where name ilike 'entrada' order by "order" asc limit 1;
    select id into v_em_contato_id from stages where name ilike '%contato%' order by "order" asc limit 1;

    for r in
        with last_msg as (
            select distinct on (lead_id) lead_id, origin, created_at
            from widechat_messages
            order by lead_id, created_at desc
        )
        select l.id, l.stage_id as from_stage_id
        from last_msg lm
        join leads l on l.id = lm.lead_id
        where l.assigned_to_id is not null
          and l.stage_id = v_entrada_id
          and lm.origin <> 'channel'
          and lm.created_at < now() - interval '24 hours'
    loop
        update leads set stage_id = v_em_contato_id, updated_at = now() where id = r.id;

        insert into lead_history (lead_id, from_stage_id, to_stage_id, changed_by, changed_at)
        values (r.id, r.from_stage_id, v_em_contato_id, null, now());

        insert into lead_notes (lead_id, note, created_by, created_at)
        values (
            r.id,
            '🔁 Correção retroativa 2026-10-08: esse lead tinha sido reaberto pra Entrada só por ter passado 24h sem resposta do cliente, mesmo já tendo agente responsável. Movido para Em Contato, mantendo o agente, pra voltar pra fila dele.',
            null,
            now()
        );

        v_count := v_count + 1;
    end loop;

    raise notice 'Leads movidos de Entrada pra Em Contato (backfill 24h-stale, 08/10): %', v_count;
end $$;
