-- 09/10, pedido do usuário: quem já é aluno (matriculado no Sponte) não é mais parte do
-- pipeline comercial — precisa de uma etapa própria ("Aluno"), separada de "Matriculado"
-- (que agora passa a significar só "era lead e virou matrícula de verdade", pra medir
-- conversão de venda com fidelidade — ver src/utils/matriculaAttribution.ts).
-- 09/10, ajustado: usuário pediu a coluna "Aluno" no FIM do quadro, não no início.
insert into stages (name, "order")
select 'Aluno', 7
where not exists (select 1 from stages where name = 'Aluno');

-- sync_leads_matriculado_from_sponte(): antes movia QUALQUER lead cujo telefone batesse
-- com uma matrícula ativa/pré-matrícula direto pra "Matriculado", sem checar se o lead
-- nasceu ANTES da matrícula (ou seja, se foi de fato aquele atendimento que converteu).
-- Agora compara leads.data_entrada com sponte_matriculas.data_matricula: só vai pra
-- "Matriculado" quem entrou no funil ANTES (ou no mesmo dia) de matricular — é conversão
-- de venda de verdade. Quem já tava matriculado antes de aparecer como lead (reabriu
-- conversa por outro motivo, aluno escrevendo no WhatsApp comercial, etc.) vai pra "Aluno".
create or replace function public.sync_leads_matriculado_from_sponte()
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
