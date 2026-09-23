-- Pedido explícito do usuário 2026-09-23: a sincronização com o Sponte (scripts/sync-sponte.mjs,
-- cron horário via GitHub Actions) sempre existiu, mas só alimentava `sponte_matriculas` e a tag
-- `perfil = 'aluno'` nos leads (ver supabase/functions/widechat-webhook e sendpulse-webhook,
-- RPC match_aluon_by_phone) — nunca movia o card no Kanban pra coluna "Matriculado". Isso sempre
-- foi 100% manual (drag-and-drop). Sintoma: coluna Matriculado com só 6 leads, enquanto 461 leads
-- já tinham o telefone batendo com uma matrícula real do Sponte (perfil='aluno') e continuavam
-- espalhados em Entrada/Em Contato/Finalizado/Perdido.
--
-- Critério confirmado com o usuário: contam como "Matriculado" as situações Vigente
-- (situacao_id = 1) e "Pré Matrícula" (situacao_id = 6) — usa o ID numérico, não o texto
-- `situacao`, porque a coluna de texto está com mojibake ("PrÃ© MatrÃ­cula") vindo do sync.
-- Cancelado/Encerrado/Rescindido NÃO contam.
--
-- Match por TELEFONE (últimos 8 dígitos, mesmo padrão de match_aluon_by_phone) entre
-- leads.telefone e sponte_matriculas.celular. Roda uma vez agora (backfill retroativo,
-- autorizado pelo usuário: move mesmo quem hoje está em Finalizado/Perdido — o Sponte é a
-- fonte de verdade sobre matrícula) e depois de hora em hora (cron), pra pegar quem nunca
-- mais escreveu pelo WhatsApp depois de matricular.

create or replace function public.sync_leads_matriculado_from_sponte() returns integer
language plpgsql
security definer
set search_path = public
as $$
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
            select id, stage_id, right(regexp_replace(coalesce(telefone, ''), '\D', '', 'g'), 8) as f8
            from leads
            where stage_id <> v_matriculado_id
        ),
        sm as (
            select distinct right(regexp_replace(coalesce(celular, ''), '\D', '', 'g'), 8) as f8
            from sponte_matriculas
            where situacao_id in (1, 6) -- Vigente, Pré Matrícula
        )
        select lt.id, lt.stage_id as from_stage_id
        from lt
        join sm on sm.f8 = lt.f8
        where length(lt.f8) = 8
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
$$;

-- backfill retroativo: roda uma vez agora
select public.sync_leads_matriculado_from_sponte();

-- e passa a rodar sozinho de hora em hora, ~20min depois do sync-sponte.yml (roda no minuto
-- 0 de cada hora, no GitHub Actions, com tempo de sobra pra terminar)
select cron.schedule(
    'sync-leads-matriculado-from-sponte',
    '25 * * * *',
    $$select public.sync_leads_matriculado_from_sponte();$$
);
