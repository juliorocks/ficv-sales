-- Pedido do usuário 08/10: "Entrada fica só pra leads novos ou que reentraram depois de
-- finalizados... mas, neste caso, entram sem assigned". O cron finalize_stale_widechat_leads()
-- (criado 18/09, corrigido 29/09 só no lookup da etapa por nome) sempre mandava o lead de
-- volta pra Entrada, mesmo mantendo o agente responsável — o card ficava "órfão": já tem
-- dono (sem botão Atender) mas fora da fila desse dono, perdido na coluna errada. Achado ao
-- vivo (08/10, leads Alice Cruz/Érica Rodrigues/Warley): agente respondeu de verdade, cliente
-- não voltou em 24h, o cron jogou pra Entrada do mesmo jeito. O backfill de 29/09
-- (fix_finalize_stale_entrada_by_name.sql) já tinha corrigido isso pontualmente pros ~211
-- leads daquele dia ("com agente -> Em Contato, sem agente -> Entrada") mas só como UPDATE
-- avulso — a função em si nunca foi atualizada, então o cron horário voltou a empurrar lead
-- com dono pra Entrada todo santo dia desde então.
CREATE OR REPLACE FUNCTION public.finalize_stale_widechat_leads()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_entrada_id integer;
    v_finalizado_id integer;
    v_em_contato_id integer;
    v_destino_id integer;
    v_note text;
    v_count integer := 0;
    r record;
begin
    select id into v_entrada_id from stages where name ilike 'entrada' order by "order" asc limit 1;
    select id into v_finalizado_id from stages where name ilike '%finaliz%' order by "order" desc limit 1;
    select id into v_em_contato_id from stages where name ilike '%contato%' order by "order" asc limit 1;

    for r in
        with last_msg as (
            select distinct on (lead_id) lead_id, origin, created_at
            from widechat_messages
            order by lead_id, created_at desc
        )
        select l.id, l.stage_id as from_stage_id, l.assigned_to_id, lm.created_at
        from last_msg lm
        join leads l on l.id = lm.lead_id
        where lm.origin <> 'channel'
          and lm.created_at < now() - interval '24 hours'
          -- exclui Matriculado/Perdido/Finalizado (nada a fazer) e Entrada/Em Contato (já
          -- estão no destino certo pro status de dono deles — sem isso o lead reaberto seria
          -- pego de novo na próxima rodada do cron e ficaria gerando nota "reaberto" pra sempre)
          and l.stage_id not in (6, 7, v_finalizado_id, v_entrada_id, v_em_contato_id)
    loop
        if r.assigned_to_id is not null and v_em_contato_id is not null then
            v_destino_id := v_em_contato_id;
            v_note := '🔁 Passaram 24h sem resposta do cliente após nossa última mensagem (janela do WhatsApp fechou). Mantido em Em Contato com o agente responsável, pra continuar o atendimento assim que o cliente responder.';
        else
            v_destino_id := v_entrada_id;
            v_note := '🔁 Passaram 24h sem resposta do cliente após nossa última mensagem (janela do WhatsApp fechou). Reaberto automaticamente para Entrada.';
        end if;

        update leads
        set stage_id = v_destino_id,
            stage_entry_date = r.created_at + interval '24 hours',
            updated_at = now()
        where id = r.id;

        insert into lead_history (lead_id, from_stage_id, to_stage_id, changed_by, changed_at)
        values (r.id, r.from_stage_id, v_destino_id, null, now());

        insert into lead_notes (lead_id, note, created_by, created_at)
        values (r.id, v_note, null, now());

        v_count := v_count + 1;
    end loop;

    return v_count;
end;
$function$;
