-- sync_leads_matriculado_from_sponte movia QUALQUER lead com match no Sponte (situacao_id
-- 1/6) pra Matriculado, sem olhar se tem contato ativo rolando. Caso real 06/10: Thayanne
-- mandou mensagem pra Kika Medeiros oferecendo uma condição (ela já é aluno de outro curso);
-- antes da Kika sequer responder, o cron passou e já puxou o card pra Matriculado — como se a
-- matrícula fosse CONSEQUÊNCIA desse contato, quando na verdade é uma matrícula antiga/de
-- outro curso que o Sponte já tinha. Pedido do usuário: lead em contato ativo (mensagem nossa
-- recente, manual ou automática) não pode ser puxado pra Matriculado por essa sincronização —
-- fica onde está até o contato esfriar (24h), o atendente decidir, ou o lead responder.
CREATE OR REPLACE FUNCTION public.sync_leads_matriculado_from_sponte()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
    v_matriculado_id integer;
    v_count integer := 0;
    r record;
begin
    select id into v_matriculado_id from stages where name ilike '%matricul%' order by "order" asc limit 1;
    if v_matriculado_id is null then
        return 0;
    end if;

    for r in
        with lt as (
            select id, stage_id, public.phone_ddd8(telefone) as key
            from leads l
            where stage_id <> v_matriculado_id
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
            select distinct public.phone_ddd8(celular) as key
            from sponte_matriculas
            where situacao_id in (1, 6) -- Vigente, Pré Matrícula
        )
        select lt.id, lt.stage_id as from_stage_id
        from lt
        join sm on sm.key = lt.key
        where lt.key is not null
    loop
        update leads
        set stage_id = v_matriculado_id,
            stage_entry_date = now(),
            perfil = 'aluno',
            updated_at = now()
        where id = r.id;

        insert into lead_history (lead_id, from_stage_id, to_stage_id, changed_by, changed_at)
        values (r.id, r.from_stage_id, v_matriculado_id, null, now());

        insert into lead_notes (lead_id, note, created_by, created_at)
        values (
            r.id,
            '🎓 Matrícula confirmada no Sponte (Vigente/Pré Matrícula) — movido automaticamente para Matriculado.',
            null,
            now()
        );

        v_count := v_count + 1;
    end loop;

    return v_count;
end;
$function$;
