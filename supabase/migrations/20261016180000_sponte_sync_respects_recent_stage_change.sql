-- Pedido do usuário 16/10: "quando a gente mover manualmente um lead de Aluno para Em
-- contato... ele não deve voltar para aluno depois novamente". O cron horário
-- sync_leads_matriculado_from_sponte() só respeitava uma janela de "esfriamento" baseada em
-- MENSAGEM recente (widechat_messages, origin agent/auto nas últimas 24h) — mover o card na
-- mão no Kanban não gera mensagem nenhuma, então a próxima rodada (até 1h depois) via o lead
-- sem mensagem recente, achava o match no Sponte de novo e devolvia pra Aluno na marra.
-- Agora a janela de 24h também vale pra QUALQUER mudança de etapa recente (stage_entry_date),
-- não só mensagem — cobre o caso manual sem perder a intenção original (não reprocessar um
-- lead que acabou de ser mexido por alguém, seja por mensagem ou arrastando o card).
CREATE OR REPLACE FUNCTION public.sync_leads_matriculado_from_sponte()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
    v_matriculado_id integer;
    v_aluno_id integer;
    v_count integer := 0;
    r record;
begin
    select id into v_matriculado_id from stages where name ilike '%matricul%' order by "order" asc limit 1;
    select id into v_aluno_id from stages where name = 'Aluno' limit 1;
    if v_matriculado_id is null or v_aluno_id is null then
        return 0;
    end if;

    for r in
        with lt as (
            select id, stage_id, data_entrada, public.phone_ddd8(telefone) as key
            from leads l
            where stage_id not in (v_matriculado_id, v_aluno_id)
              -- mudança de etapa recente (manual ou não) — respeita quem mexeu no lead por
              -- último, não reprocessa na marra
              and l.stage_entry_date < now() - interval '24 hours'
              -- contato ativo nosso (mensagem saída, manual ou automática) nas últimas 24h:
              -- a sincronização espera esfriar, não interrompe no meio
              and not exists (
                select 1 from widechat_messages wm
                where wm.lead_id = l.id
                  and wm.origin in ('agent', 'auto')
                  and wm.created_at >= now() - interval '24 hours'
              )
        ),
        sm as (
            select public.phone_ddd8(celular) as key, min(data_matricula) as data_matricula
            from sponte_matriculas
            where situacao_id in (1, 6) -- Vigente, Pré Matrícula
            group by public.phone_ddd8(celular)
        )
        select lt.id, lt.stage_id as from_stage_id,
               case when lt.data_entrada::date <= sm.data_matricula then v_matriculado_id else v_aluno_id end as to_stage_id,
               case when lt.data_entrada::date <= sm.data_matricula then true else false end as is_conversao
        from lt
        join sm on sm.key = lt.key
        where lt.key is not null
    loop
        update leads
        set stage_id = r.to_stage_id,
            stage_entry_date = now(),
            perfil = 'aluno',
            updated_at = now()
        where id = r.id;

        insert into lead_history (lead_id, from_stage_id, to_stage_id, changed_by, changed_at)
        values (r.id, r.from_stage_id, r.to_stage_id, null, now());

        insert into lead_notes (lead_id, note, created_by, created_at)
        values (
            r.id,
            case when r.is_conversao
                then '🎓 Matrícula confirmada no Sponte (Vigente/Pré Matrícula) — movido automaticamente para Matriculado.'
                else '👤 Contato já era aluno matriculado no Sponte antes de entrar no funil — movido para Aluno (fora do pipeline comercial).'
            end,
            null,
            now()
        );

        v_count := v_count + 1;
    end loop;

    return v_count;
end;
$function$;
