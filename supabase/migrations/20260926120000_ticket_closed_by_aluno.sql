-- Aluno encerra o próprio chamado pelo portal: marca quem encerrou (a equipe vê) e não
-- manda o e-mail "chamado resolvido" (foi o próprio aluno quem fechou).
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS encerrado_pelo_aluno boolean NOT NULL DEFAULT false;
