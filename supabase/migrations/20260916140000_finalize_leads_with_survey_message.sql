-- Leads que já receberam a pesquisa de satisfação do Widechat ("Sua opinião é
-- muito importante... avalie o atendimento realizado...") tiveram o atendimento
-- encerrado de fato, mas o webhook não reconhecia esse texto como sinal de
-- fim de conversa (só reconhecia "atendimento finalizado"/"conversa finalizada"/
-- "atendimento encerrado") — então ficavam presos em Entrada/Em Contato mesmo
-- já resolvidos. Corrigido em código (CONV_END_TEXT) pra daqui pra frente;
-- esta migration corrige o passado.
--
-- Só move quem: (a) teve pelo menos uma mensagem real do cliente na conversa
-- (origin=channel) — não finaliza contato que nunca respondeu nada; e (b) NÃO
-- voltou a escrever depois da última pesquisa de satisfação enviada — quem
-- reengajou depois está ativo de verdade e deve continuar onde está.

do $$
declare
    v_finalizado_id integer;
begin
    select id into v_finalizado_id from stages where name ilike '%finaliz%' order by "order" desc limit 1;

    with survey as (
        select l.id as lead_id, l.widechat_session_id as sid,
               max(m.created_at) as closed_at
        from widechat_raw_messages m
        join leads l on l.widechat_session_id = m.session_id
        where m.message ilike '%avalie o atendimento%' and l.stage_id not in (6, 7, v_finalizado_id)
        group by l.id, l.widechat_session_id
    ),
    eligible as (
        select s.lead_id, s.closed_at
        from survey s
        where exists (select 1 from widechat_raw_messages rm where rm.session_id = s.sid and rm.origin = 'channel')
          and not exists (
              select 1 from widechat_raw_messages rm
              where rm.session_id = s.sid and rm.origin = 'channel' and rm.created_at > s.closed_at
          )
    )
    update leads l
    set stage_id = v_finalizado_id,
        stage_entry_date = e.closed_at,
        updated_at = now()
    from eligible e
    where l.id = e.lead_id;
end $$;
