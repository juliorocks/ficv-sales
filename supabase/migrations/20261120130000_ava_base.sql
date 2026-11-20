-- AVA (substituto do Moodle): cursos, seções, aulas, progresso e lista de alunos liberados no teste.
-- Tudo é lido/escrito pela edge function `ava-api` (service role); o navegador não acessa as tabelas direto.

create table if not exists public.ava_cursos (
  id bigserial primary key,
  moodle_id int unique,
  nome text not null,                 -- nome completo do Moodle (referência)
  titulo text not null,               -- disciplina, como o aluno vê
  curso_area text,                    -- TEOLOGIA, DIREITO, PÓS...
  periodo text,                       -- P1, P2, Modular...
  semestre text,                      -- 2026.2
  professor text,
  capa_url text,
  descricao text,
  publicado boolean not null default false,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table if not exists public.ava_secoes (
  id bigserial primary key,
  curso_id bigint not null references public.ava_cursos(id) on delete cascade,
  moodle_id int,
  nome text not null,
  ordem int not null default 0,
  unique (curso_id, moodle_id)
);

create table if not exists public.ava_aulas (
  id bigserial primary key,
  curso_id bigint not null references public.ava_cursos(id) on delete cascade,
  secao_id bigint not null references public.ava_secoes(id) on delete cascade,
  moodle_id int,                      -- id do módulo no Moodle
  sub int not null default 0,         -- 2º, 3º vídeo dentro do mesmo rótulo
  tipo text not null check (tipo in ('video','material','quiz','link','texto','forum')),
  titulo text not null,
  video_id text,                      -- id do Vimeo
  video_hash text,                    -- parâmetro h= dos vídeos privados
  thumb_url text,
  duracao_seg int,
  url text,                           -- material/link (Moodle ou externo)
  descricao text,
  ordem int not null default 0,
  unique (curso_id, moodle_id, sub)
);
create index if not exists ava_aulas_curso_idx on public.ava_aulas (curso_id, ordem);
create index if not exists ava_secoes_curso_idx on public.ava_secoes (curso_id, ordem);

create table if not exists public.ava_progresso (
  aluno_id uuid not null,
  aula_id bigint not null references public.ava_aulas(id) on delete cascade,
  curso_id bigint not null references public.ava_cursos(id) on delete cascade,
  posicao_seg int not null default 0,
  concluida boolean not null default false,
  concluida_em timestamptz,
  atualizado_em timestamptz not null default now(),
  primary key (aluno_id, aula_id)
);
create index if not exists ava_progresso_curso_idx on public.ava_progresso (aluno_id, curso_id);

-- Fase de teste: só entra no AVA quem está aqui (além do link /ava).
create table if not exists public.ava_liberados (
  aluno_id uuid primary key,
  obs text,
  criado_em timestamptz not null default now()
);

alter table public.ava_cursos enable row level security;
alter table public.ava_secoes enable row level security;
alter table public.ava_aulas enable row level security;
alter table public.ava_progresso enable row level security;
alter table public.ava_liberados enable row level security;

create policy ava_cursos_admin on public.ava_cursos for all using (public.is_admin()) with check (public.is_admin());
create policy ava_secoes_admin on public.ava_secoes for all using (public.is_admin()) with check (public.is_admin());
create policy ava_aulas_admin on public.ava_aulas for all using (public.is_admin()) with check (public.is_admin());
create policy ava_progresso_admin on public.ava_progresso for select using (public.is_admin());
create policy ava_liberados_admin on public.ava_liberados for all using (public.is_admin()) with check (public.is_admin());
