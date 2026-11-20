-- Estrutura acadêmica (o "nosso Sponte", fase 1): programas, turmas, turnos, salas, professores e ofertas de disciplina.
-- Sincronizada do Sponte (programas/turmas) e do AVA/Moodle (ofertas/professores) por `ac_sincronizar()`; edição só admin.

create table if not exists public.ac_programas (
  id bigserial primary key,
  nome text not null,
  nivel text not null default 'graduacao' check (nivel in ('graduacao','pos')),
  sponte_curso_id text unique,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);
create table if not exists public.ac_turnos (id bigserial primary key, nome text not null unique);
create table if not exists public.ac_salas (
  id bigserial primary key, nome text not null, polo text, capacidade int, ativo boolean not null default true
);
create table if not exists public.ac_turmas (
  id bigserial primary key,
  sponte_turma_id int unique,
  programa_id bigint references public.ac_programas(id) on delete set null,
  nome text not null,
  semestre text,
  periodo text,
  modalidade text not null default 'periodo' check (modalidade in ('periodo','modular','pos')),
  data_inicio date,
  data_termino date,
  turno_id bigint references public.ac_turnos(id) on delete set null,
  sala_id bigint references public.ac_salas(id) on delete set null,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);
create table if not exists public.ac_professores (
  id bigserial primary key,
  nome text not null,
  email text,
  profile_id uuid,
  moodle_user_id int,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);
create unique index if not exists ac_professores_nome_uq on public.ac_professores (lower(btrim(nome)));
create table if not exists public.ac_ofertas (
  id bigserial primary key,
  ava_curso_id bigint unique references public.ava_cursos(id) on delete cascade,
  disciplina text not null,
  semestre text,
  periodo text,
  nivel text not null default 'graduacao' check (nivel in ('graduacao','pos')),
  programa_id bigint references public.ac_programas(id) on delete set null,
  turma_id bigint references public.ac_turmas(id) on delete set null,
  turno_id bigint references public.ac_turnos(id) on delete set null,
  sala_id bigint references public.ac_salas(id) on delete set null,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);
create table if not exists public.ac_oferta_professores (
  oferta_id bigint not null references public.ac_ofertas(id) on delete cascade,
  professor_id bigint not null references public.ac_professores(id) on delete cascade,
  primary key (oferta_id, professor_id)
);
create index if not exists ac_ofertas_semestre_idx on public.ac_ofertas (semestre, nivel);
create index if not exists ac_turmas_programa_idx on public.ac_turmas (programa_id);

do $$ declare t text; begin
  foreach t in array array['ac_programas','ac_turnos','ac_salas','ac_turmas','ac_professores','ac_ofertas','ac_oferta_professores'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t||'_sel', t);
    execute format('create policy %I on public.%I for select using (public.is_staff())', t||'_sel', t);
    execute format('drop policy if exists %I on public.%I', t||'_adm', t);
    execute format('create policy %I on public.%I for all using (public.is_admin()) with check (public.is_admin())', t||'_adm', t);
  end loop;
end $$;

insert into public.ac_turnos (nome) values ('Manhã'),('Tarde'),('Noite'),('EAD (assíncrono)') on conflict do nothing;

-- Importa/atualiza a partir do Sponte e do AVA. Idempotente; nunca sobrescreve o que a equipe editou.
create or replace function public.ac_sincronizar() returns jsonb
language plpgsql security definer set search_path = public as $$
declare n_prog int; n_turm int; n_prof int; n_of int;
begin
  if not public.is_admin() then raise exception 'Só admin.'; end if;

  insert into ac_programas (nome, nivel, sponte_curso_id)
  select max(nome_curso), case when max(nome_curso) ~* 'p[óo]s' then 'pos' else 'graduacao' end, curso_id
    from sponte_matriculas where curso_id is not null and nome_curso is not null group by curso_id
  on conflict (sponte_curso_id) do nothing;
  get diagnostics n_prog = row_count;

  insert into ac_turmas (sponte_turma_id, programa_id, nome, semestre, periodo, modalidade, data_inicio, data_termino)
  select m.turma_id, p.id, m.nome, substring(m.nome from '20\d\d\.\d'),
         case when m.nome ~* 'modular' then 'Modular' else substring(m.nome from '\yP\d+\y') end,
         case when m.nome ~* 'p[óo]s' then 'pos' when m.nome ~* 'modular' then 'modular' else 'periodo' end,
         m.ini, m.fim
    from (select turma_id, max(nome_turma) nome, max(curso_id) curso_id, min(data_inicio) ini, max(data_termino) fim
            from sponte_matriculas where turma_id is not null and nome_turma is not null group by turma_id) m
    left join ac_programas p on p.sponte_curso_id = m.curso_id
  on conflict (sponte_turma_id) do update set data_inicio = excluded.data_inicio, data_termino = excluded.data_termino;
  get diagnostics n_turm = row_count;

  -- professores: nomes das disciplinas do AVA (equipe de orientação com mais de 4 nomes é ignorada)
  insert into ac_professores (nome)
  select distinct case when n = upper(n) then initcap(lower(n)) else n end
    from (select btrim(unnest(string_to_array(professor, ' / '))) n from ava_cursos
           where professor is not null and array_length(string_to_array(professor, ' / '), 1) <= 4) x
   where n <> ''
  on conflict do nothing;
  get diagnostics n_prof = row_count;

  insert into ac_ofertas (ava_curso_id, disciplina, semestre, periodo, nivel)
  select id, titulo, semestre, periodo, case when nome ~* 'p[óo]s' then 'pos' else 'graduacao' end from ava_cursos
  on conflict (ava_curso_id) do nothing;
  get diagnostics n_of = row_count;

  insert into ac_oferta_professores (oferta_id, professor_id)
  select o.id, p.id
    from ac_ofertas o join ava_cursos c on c.id = o.ava_curso_id
    cross join lateral unnest(string_to_array(c.professor, ' / ')) nm
    join ac_professores p on lower(btrim(p.nome)) = lower(btrim(nm))
   where c.professor is not null and array_length(string_to_array(c.professor, ' / '), 1) <= 4
  on conflict do nothing;

  return jsonb_build_object('programas', n_prog, 'turmas', n_turm, 'professores', n_prof, 'ofertas', n_of);
end $$;

-- Turmas com programa e alunos vigentes (leitura da equipe)
create or replace function public.ac_turmas_listar() returns table (
  id bigint, sponte_turma_id int, nome text, semestre text, periodo text, modalidade text, data_inicio date, data_termino date,
  ativo boolean, programa_id bigint, programa text, nivel text, turno_id bigint, sala_id bigint, vigentes bigint, total bigint
) language sql stable security definer set search_path = public as $$
  select t.id, t.sponte_turma_id, t.nome, t.semestre, t.periodo, t.modalidade, t.data_inicio, t.data_termino, t.ativo,
         t.programa_id, p.nome, p.nivel, t.turno_id, t.sala_id,
         count(m.id) filter (where m.situacao = 'Vigente'), count(m.id)
    from ac_turmas t left join ac_programas p on p.id = t.programa_id
    left join sponte_matriculas m on m.turma_id = t.sponte_turma_id
   where public.is_staff()
   group by t.id, p.nome, p.nivel
   order by t.data_inicio desc nulls last, t.nome
$$;
