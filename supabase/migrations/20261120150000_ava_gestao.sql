-- AVA: gestão de conteúdo pela equipe (professor, coordenador, admin).
-- `editado` protege o que a equipe mexeu: a importação do Moodle não sobrescreve.
-- `oculto` esconde do aluno sem apagar. Disciplina só aparece para aluno comum se `publicado`.
alter table public.ava_cursos add column if not exists editado boolean not null default false;
alter table public.ava_secoes add column if not exists editado boolean not null default false;
alter table public.ava_secoes add column if not exists oculto boolean not null default false;
alter table public.ava_aulas add column if not exists editado boolean not null default false;
alter table public.ava_aulas add column if not exists oculto boolean not null default false;

-- professor/tutor responsável por cada disciplina (o professor só gerencia as vinculadas)
create table if not exists public.ava_curso_professores (
  curso_id bigint not null references public.ava_cursos(id) on delete cascade,
  user_id uuid not null,
  primary key (curso_id, user_id)
);
create index if not exists ava_curso_professores_user_idx on public.ava_curso_professores (user_id);
alter table public.ava_curso_professores enable row level security;
create policy ava_curso_professores_admin on public.ava_curso_professores for all using (public.is_admin()) with check (public.is_admin());

-- o que já foi importado continua visível (antes não havia o conceito de publicado)
update public.ava_cursos set publicado = true where publicado = false;
