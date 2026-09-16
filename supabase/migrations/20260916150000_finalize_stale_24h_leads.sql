-- Regra: se a ÚLTIMA mensagem de um lead fomos NÓS (agente/template/bot) e já
-- se passaram 24h sem o cliente responder, a janela de atendimento do WhatsApp
-- fechou (só dá pra mandar template aprovado — ver alerta amarelo em
-- WideChatHistory.tsx) e não tem mais nada que o time consiga fazer até o
-- cliente escrever de nascer. Move pra Finalizado. Cobre TANTO leads já
-- assumidos (ex: "Estevão", parado em Em Contato) QUANTO leads ainda em
-- Entrada sem ninguém ter assumido (a maioria nunca teve nenhuma resposta,
-- nem ao 1º template) — confirmado com o usuário 2026-09-16 que os dois casos
-- devem ser movidos.
--
-- Não mexe em quem já está Matriculado/Perdido/Finalizado, nem em quem a
-- ÚLTIMA mensagem foi do cliente (origin='channel') — esse caso é "cliente
-- escreveu e a gente não respondeu", um problema diferente (falha de
-- atendimento), não deve ser arquivado silenciosamente.
--
-- stage_entry_date = quando a janela de 24h efetivamente fechou (última
-- mensagem + 24h), não now() — preserva a ordenação cronológica real da
-- coluna Finalizado em vez de empilhar tudo "hoje".

create or replace function public.finalize_stale_widechat_leads() returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_finalizado_id integer;
    v_count integer;
begin
    select id into v_finalizado_id from stages where name ilike '%finaliz%' order by "order" desc limit 1;

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

-- roda a limpeza retroativa uma vez agora
select public.finalize_stale_widechat_leads();

-- e passa a rodar sozinho de hora em hora daqui pra frente
select cron.schedule(
    'finalize-stale-widechat-leads',
    '17 * * * *',
    $$select public.finalize_stale_widechat_leads();$$
);
