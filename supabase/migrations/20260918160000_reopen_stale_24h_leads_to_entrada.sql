-- Pedido explícito do usuário 2026-09-18: fechar a conversa por causa das 24h sem
-- resposta do cliente NÃO é uma finalização de verdade — o atendimento continua em
-- aberto do lado do negócio (o agente só não pode mais mandar texto livre até o
-- cliente responder, só template). Exemplo real: lead "Tatiana Barbosa da Silva"
-- (id 10503802), ainda esperando resposta sobre documentação, foi parar em
-- Finalizado só porque passou da janela — o atendimento sumiu do radar do agente.
--
-- Esse fechamento por tempo acontecia por dois caminhos:
--  1) o cron horário `finalize_stale_widechat_leads()` (20260916150000/20260917190000),
--     que olha a última mensagem e, se já passou 24h sem resposta do cliente, mandava
--     pra Finalizado;
--  2) o webhook do WideChat, quando ELE PRÓPRIO encerra a attendance por timeout
--     (evento "autoFinish" — corrigido em código nesta mesma leva de mudanças, ver
--     supabase/functions/widechat-webhook/index.ts).
--
-- Esta migration corrige o primeiro caminho (o cron passa a devolver pra Entrada, com
-- o mesmo agente, em vez de arquivar em Finalizado) e faz o backfill retroativo dos
-- dois: reabre pra Entrada qualquer lead que hoje está em Finalizado mas cujo
-- fechamento bate com a assinatura de "fechou só por tempo" — hiato grande (>= 20h)
-- entre a última mensagem e o momento em que foi finalizado (finalização de verdade,
-- manual ou pela pesquisa de satisfação do WideChat, acontece minutos depois da
-- última troca, não ~24h+ depois).

create or replace function public.finalize_stale_widechat_leads() returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_entrada_id integer;
    v_finalizado_id integer;
    v_count integer := 0;
    r record;
begin
    select id into v_entrada_id from stages order by "order" asc limit 1;
    select id into v_finalizado_id from stages where name ilike '%finaliz%' order by "order" desc limit 1;

    for r in
        with last_msg as (
            select distinct on (lead_id) lead_id, origin, created_at
            from widechat_messages
            order by lead_id, created_at desc
        )
        select l.id, l.stage_id as from_stage_id, lm.created_at
        from last_msg lm
        join leads l on l.id = lm.lead_id
        where lm.origin <> 'channel'
          and lm.created_at < now() - interval '24 hours'
          -- exclui Matriculado/Perdido/Finalizado (nada a fazer) e Entrada (já está
          -- de volta lá — sem isso, o lead reaberto seria pego de novo na próxima
          -- rodada do cron e ficaria gerando nota "reaberto" toda hora pra sempre)
          and l.stage_id not in (6, 7, v_finalizado_id, v_entrada_id)
    loop
        update leads
        set stage_id = v_entrada_id,
            stage_entry_date = r.created_at + interval '24 hours',
            updated_at = now()
        where id = r.id;

        insert into lead_history (lead_id, from_stage_id, to_stage_id, changed_by, changed_at)
        values (r.id, r.from_stage_id, v_entrada_id, null, now());

        insert into lead_notes (lead_id, note, created_by, created_at)
        values (
            r.id,
            '🔁 Passaram 24h sem resposta do cliente após nossa última mensagem (janela do WhatsApp fechou). Reaberto automaticamente para Entrada, mantendo o agente responsável, pra continuar o atendimento assim que o cliente responder.',
            null,
            now()
        );

        v_count := v_count + 1;
    end loop;

    return v_count;
end;
$$;

-- ─── backfill retroativo ────────────────────────────────────────────────────────
-- Reabre pra Entrada quem já está em Finalizado com a assinatura de "fechou só por
-- tempo" (hiato >= 20h entre a última mensagem e o stage_entry_date do fechamento).
-- Restrito a stage_entry_date >= 2026-09-04 (cutover pra este Supabase — ver
-- [[project_surreal_migration]]): sem esse corte, a mesma assinatura também bate em
-- ~216 leads de Março–Agosto/2026 migrados com estado histórico do sistema antigo,
-- que não têm nada a ver com este bug e não devem ser mexidos.
do $$
declare
    v_entrada_id integer;
    v_count integer := 0;
    r record;
begin
    select id into v_entrada_id from stages order by "order" asc limit 1;

    for r in
        with last_msg as (
            select distinct on (lead_id) lead_id, created_at
            from widechat_messages
            order by lead_id, created_at desc
        )
        select l.id, l.stage_id as from_stage_id
        from leads l
        join stages s on s.id = l.stage_id
        join last_msg lm on lm.lead_id = l.id
        where s.name ilike '%finaliz%'
          and l.assigned_to_id is not null
          and l.stage_entry_date >= lm.created_at + interval '20 hours'
          and l.stage_entry_date >= '2026-09-04'
    loop
        update leads
        set stage_id = v_entrada_id,
            stage_entry_date = now(),
            updated_at = now()
        where id = r.id;

        insert into lead_history (lead_id, from_stage_id, to_stage_id, changed_by, changed_at)
        values (r.id, r.from_stage_id, v_entrada_id, null, now());

        insert into lead_notes (lead_id, note, created_by, created_at)
        values (
            r.id,
            '🔁 Correção retroativa 2026-09-18: esse lead tinha sido finalizado só por ter passado 24h sem resposta do cliente, não por atendimento concluído de verdade. Reaberto para Entrada, mantendo o agente responsável, pra continuar o atendimento assim que o cliente responder.',
            null,
            now()
        );

        v_count := v_count + 1;
    end loop;

    raise notice 'Leads reabertos retroativamente (backfill 24h-stale): %', v_count;
end $$;
