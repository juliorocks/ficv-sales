-- Histórico do Moodle: marca de quais disciplinas já tiveram as conclusões do aluno importadas.
create table if not exists public.ava_moodle_sync (
  aluno_id uuid not null,
  curso_id bigint not null references public.ava_cursos(id) on delete cascade,
  importadas int not null default 0,
  sincronizado_em timestamptz not null default now(),
  primary key (aluno_id, curso_id)
);
alter table public.ava_moodle_sync enable row level security;
