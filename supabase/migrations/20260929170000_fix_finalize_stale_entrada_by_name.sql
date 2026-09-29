-- Bug encontrado ao vivo (29/09, 2ª vez no mesmo dia): finalize_stale_widechat_leads()
-- achava a etapa "Entrada" pegando "a etapa com menor order" — funcionava enquanto Entrada
-- tinha order=1, mas quebrou quando as colunas do Kanban foram reordenadas (IA Atendendo
-- passou a ter order=1, Entrada foi pra order=2). Toda rodada do cron (*/hora no minuto 17)
-- desde então jogou os leads "24h sem resposta" pra IA Atendendo em vez de Entrada — ~210
-- leads de uma vez, repetindo a cada hora. Troca pra achar por NOME (como já fazia com
-- Finalizado), não por posição — não quebra de novo se a ordem das colunas mudar.
CREATE OR REPLACE FUNCTION public.finalize_stale_widechat_leads()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_entrada_id integer;
    v_finalizado_id integer;
    v_count integer := 0;
    r record;
begin
    select id into v_entrada_id from stages where name ilike 'entrada' order by "order" asc limit 1;
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
$function$;

-- corrige os ~211 leads que a rodada de 12:17/13:17 já jogou errado pra IA Atendendo:
-- com agente atribuído -> Em Contato (era onde estavam antes de ficar 24h sem resposta);
-- sem agente -> Entrada. Não toca em quem tem sessão de IA real ativa (ai_lead_sessions).
UPDATE leads
   SET stage_id = CASE WHEN assigned_to_id IS NOT NULL THEN 2 ELSE 1 END,
       updated_at = now()
 WHERE stage_id = 9
   AND id NOT IN (SELECT lead_id FROM ai_lead_sessions);
