-- Pedido explícito do usuário 2026-09-17: lead que entrou (Entrada) e NUNCA teve
-- resposta de um AGENTE humano (só bot/template) não pode ser finalizado sozinho
-- pelo cron de 24h — isso costuma acontecer em fim de semana (janela de 24h passa
-- sem ninguém do time trabalhando) e o lead "some" de Entrada pra Finalizado sem
-- ninguém saber que ele existia, ficando sem atendimento nenhum.
--
-- Regra antiga (20260916150000): última msg NOSSA (agente/bot/template) + 24h sem
-- resposta do cliente -> Finalizado, cobrindo TANTO lead já assumido QUANTO lead
-- ainda em Entrada nunca assumido (decisão de 16/09). Essa 2ª parte é exatamente o
-- que o usuário quer excluir agora: se NENHUMA mensagem de origin='agent' existe
-- pra esse lead e ele ainda está no 1º estágio (Entrada), NÃO finaliza — fica lá até
-- alguém de fato olhar.
--
-- Continua finalizando normalmente: lead JÁ assumido (teve pelo menos 1 msg de
-- agente) que ficou 24h+ sem resposta do cliente depois da nossa última msg —
-- esse é o caso "a gente que não retomou", intencional continuar finalizando.

create or replace function public.finalize_stale_widechat_leads() returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_finalizado_id integer;
    v_entrada_id integer;
    v_count integer;
begin
    select id into v_finalizado_id from stages where name ilike '%finaliz%' order by "order" desc limit 1;
    select id into v_entrada_id from stages order by "order" asc limit 1;

    with last_msg as (
        select distinct on (lead_id) lead_id, origin, created_at
        from widechat_messages
        order by lead_id, created_at desc
    ),
    target as (
        select l.id, lm.created_at
        from last_msg lm
        join leads l on l.id = lm.lead_id
        where lm.origin <> 'channel'
          and lm.created_at < now() - interval '24 hours'
          and l.stage_id not in (6, 7, v_finalizado_id)
          and not (
              l.stage_id = v_entrada_id
              and not exists (
                  select 1 from widechat_messages wm
                  where wm.lead_id = l.id and wm.origin = 'agent'
              )
          )
    )
    update leads l
    set stage_id = v_finalizado_id,
        stage_entry_date = t.created_at + interval '24 hours',
        updated_at = now()
    from target t
    where l.id = t.id;

    get diagnostics v_count = row_count;
    return v_count;
end;
$$;
