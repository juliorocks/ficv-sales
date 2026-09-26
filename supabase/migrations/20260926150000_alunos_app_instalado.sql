-- Portal do Aluno como app (PWA): marca quando o aluno abriu o portal pelo app instalado,
-- pra não mostrar mais o convite "Instale o app" nem no navegador (no iPhone o Safari
-- não tem como saber sozinho que o app foi adicionado à tela inicial).
ALTER TABLE public.alunos ADD COLUMN IF NOT EXISTS app_instalado_em timestamptz;
