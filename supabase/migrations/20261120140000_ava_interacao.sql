-- AVA: anotações do aluno, perguntas e respostas por disciplina/aula, avisos da turma e registro do assistente (IA).
-- Acesso só pela edge function `ava-api` (service role); o navegador não lê as tabelas direto.

create table if not exists public.ava_anotacoes (
  id bigserial primary key,
  aluno_id uuid not null,
  curso_id bigint not null references public.ava_cursos(id) on delete cascade,
  aula_id bigint not null references public.ava_aulas(id) on delete cascade,
  segundos int not null default 0,
  texto text not null check (length(texto) between 1 and 2000),
  criado_em timestamptz not null default now()
);
create index if not exists ava_anotacoes_idx on public.ava_anotacoes (aluno_id, curso_id, criado_em desc);

create table if not exists public.ava_perguntas (
  id bigserial primary key,
  curso_id bigint not null references public.ava_cursos(id) on delete cascade,
  aula_id bigint references public.ava_aulas(id) on delete set null,
  aluno_id uuid not null,
  autor_nome text not null,
  titulo text not null check (length(titulo) between 3 and 160),
  texto text not null check (length(texto) between 1 and 4000),
  resolvida boolean not null default false,
  criado_em timestamptz not null default now()
);
create index if not exists ava_perguntas_idx on public.ava_perguntas (curso_id, criado_em desc);

create table if not exists public.ava_respostas (
  id bigserial primary key,
  pergunta_id bigint not null references public.ava_perguntas(id) on delete cascade,
  autor_tipo text not null check (autor_tipo in ('aluno','professor','equipe')),
  autor_id uuid,
  autor_nome text not null,
  texto text not null check (length(texto) between 1 and 4000),
  criado_em timestamptz not null default now()
);
create index if not exists ava_respostas_idx on public.ava_respostas (pergunta_id, criado_em);

-- curso_id nulo = aviso para todas as disciplinas
create table if not exists public.ava_avisos (
  id bigserial primary key,
  curso_id bigint references public.ava_cursos(id) on delete cascade,
  titulo text not null,
  texto text not null,
  autor_nome text,
  publicado boolean not null default true,
  criado_em timestamptz not null default now()
);

create table if not exists public.ava_assistente_log (
  id bigserial primary key,
  aluno_id uuid not null,
  curso_id bigint,
  aula_id bigint,
  pergunta text not null,
  resposta text,
  trechos int not null default 0,
  criado_em timestamptz not null default now()
);
create index if not exists ava_assistente_log_idx on public.ava_assistente_log (aluno_id, criado_em desc);

alter table public.ava_anotacoes enable row level security;
alter table public.ava_perguntas enable row level security;
alter table public.ava_respostas enable row level security;
alter table public.ava_avisos enable row level security;
alter table public.ava_assistente_log enable row level security;

create policy ava_anotacoes_admin on public.ava_anotacoes for select using (public.is_admin());
create policy ava_perguntas_staff on public.ava_perguntas for select using (public.is_staff());
create policy ava_respostas_staff on public.ava_respostas for select using (public.is_staff());
create policy ava_avisos_admin on public.ava_avisos for all using (public.is_admin()) with check (public.is_admin());
create policy ava_assistente_log_admin on public.ava_assistente_log for select using (public.is_admin());
