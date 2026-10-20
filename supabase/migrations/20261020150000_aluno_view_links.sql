-- Visualização do Portal do Aluno pelo admin, só leitura, com link que expira.
-- O link guarda só o hash do token (um vazamento do banco não entrega links válidos).
CREATE TABLE IF NOT EXISTS public.aluno_view_links (
    token_hash text PRIMARY KEY,
    aluno_id uuid NOT NULL REFERENCES public.alunos(id) ON DELETE CASCADE,
    created_by uuid REFERENCES public.profiles(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS public.aluno_view_log (
    id bigserial PRIMARY KEY,
    token_hash text NOT NULL,
    aluno_id uuid NOT NULL,
    created_by uuid,
    acao text NOT NULL,
    viewed_at timestamptz NOT NULL DEFAULT now()
);

-- sem policies: só a service role (edge function aluno-view) acessa
ALTER TABLE public.aluno_view_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aluno_view_log ENABLE ROW LEVEL SECURITY;
