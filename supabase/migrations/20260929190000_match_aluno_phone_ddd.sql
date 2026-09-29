-- match_aluno_by_phone comparava só os ÚLTIMOS 8 DÍGITOS do telefone — descartava o DDD
-- inteiro. Dois números de CIDADES DIFERENTES com os mesmos 8 dígitos finais (bem possível
-- em números de celular brasileiros) batiam como se fossem a mesma pessoa. Os casos reais
-- encontrados hoje (29/09) eram colisão de número de verdade (mesmo DDD, número de teste
-- reaproveitado) — essa troca não teria evitado ESSES dois, mas fecha uma categoria de erro
-- maior (DDD diferente, mesmos 8 dígitos finais) que também é risco real com clientes de
-- verdade, não só números de teste.
--
-- phone_ddd8(): chave = DDD (2 dígitos) + últimos 8 dígitos — tolerante a código do país
-- (55) e ao 9º dígito do celular (presente ou não). DDD vem sempre dos 2 primeiros dígitos
-- DEPOIS de tirar o "55" (se tiver) — não "os 2 antes dos últimos 8", que dá errado quando
-- o 9º dígito do celular está no meio (achado testando: "83" virava "39").
CREATE OR REPLACE FUNCTION public.phone_ddd8(p text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN d ~ '^55\d{10,11}$' THEN substring(d from 3 for 2) || right(d, 8)  -- 55 + DDD + número
    WHEN length(d) IN (10, 11) THEN substring(d from 1 for 2) || right(d, 8) -- DDD + número, sem código do país
    ELSE NULL
  END
  FROM (SELECT regexp_replace(coalesce(p, ''), '\D', '', 'g') AS d) x;
$$;

CREATE OR REPLACE FUNCTION public.match_aluno_by_phone(p_phone text)
RETURNS TABLE(aluno text, nome_curso text)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  WITH d AS (SELECT public.phone_ddd8(p_phone) AS key)
  SELECT sm.aluno, sm.nome_curso
    FROM sponte_matriculas sm, d
   WHERE d.key IS NOT NULL
     AND public.phone_ddd8(sm.celular) = d.key
   ORDER BY sm.data_matricula DESC NULLS LAST
   LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.match_aluno_by_phone(text) TO service_role, authenticated;

-- mesma troca no cron de sincronização de Matriculado (usava o mesmo "últimos 8 dígitos"
-- direto, sem passar pela função — agora os dois usam a mesma regra).
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
            from leads
            where stage_id <> v_matriculado_id
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
