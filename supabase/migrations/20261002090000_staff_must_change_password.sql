-- Troca obrigatória de senha no 1º acesso pra equipe (CRM/Chamados) — pedido do usuário
-- 02/10, mesmo esquema que o Portal do Aluno já tinha (alunos.must_change_password), agora
-- pro lado staff (profiles). Default FALSE: contas já existentes não são afetadas, só as
-- NOVAS (admin-manage-users 'create') e as que tiverem a senha resetada por um admin
-- ('reset_password') — nos dois casos quem escolheu a senha foi o admin, não a pessoa.
alter table public.profiles
  add column if not exists must_change_password boolean not null default false;

comment on column public.profiles.must_change_password is
  'Força a tela de troca de senha no próximo login (App.tsx, ForceChangePassword) — true logo após o admin criar a conta ou resetar a senha (ver supabase/functions/admin-manage-users).';
