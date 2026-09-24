-- Pedido explícito do usuário 2026-09-24: filtro de Departamento no Kanban, que
-- narrows a lista de "Atendentes" (profiles, quem pode ser assigned_to_id de um
-- lead) pra só quem é daquele departamento.
--
-- `profiles` (contas reais de login, ligadas a leads.assigned_to_id) NÃO tem coluna
-- de equipe hoje. As duas tabelas de equipe já existentes são conceitualmente
-- diferentes e DE PROPÓSITO desacopladas uma da outra (ver comentários em
-- App.tsx:493-498, AgentAdmin.tsx:127, TeamsAdmin.tsx:34-36):
--   - `agent_team` (agent_id/team_id) = roster do webhook do WideChat (quem pode
--     atender o número comercial) — NÃO usar aqui, é lógica crítica de roteamento.
--   - `agent_profiles.team_id` = equipe do SETOR pra métricas/dashboard de outra
--     identidade de agente (`agent_profiles`, sem FK pra `profiles`).
-- Nenhuma das duas serve pra filtrar `profiles` diretamente. Criando uma coluna
-- NOVA e independente em `profiles`, sem tocar nas outras duas.
alter table public.profiles
    add column if not exists team_id uuid references public.teams(id) on delete set null;

-- Backfill dos 6 perfis com equipe conhecida com confiança (nome bate exato ou
-- claramente com `agent_profiles`/`agent_team` — conferido via REST antes de rodar
-- esta migration). "Marketing" e "Victor Grisi" ficam sem equipe (null) — não achei
-- fonte confiável pra inferir; usuário pode corrigir depois.
update public.profiles set team_id = (select id from public.teams where name = 'Secretaria')
    where full_name = 'Izabelly Souza';
update public.profiles set team_id = (select id from public.teams where name = 'Comercial')
    where full_name = 'Karina Pimentel';
update public.profiles set team_id = (select id from public.teams where name = 'Comercial')
    where full_name = 'Thayanne Sales';
update public.profiles set team_id = (select id from public.teams where name = 'Secretaria')
    where full_name = 'Matheus';
update public.profiles set team_id = (select id from public.teams where name = 'Secretaria')
    where full_name = 'Tyago';
update public.profiles set team_id = (select id from public.teams where name = 'Comercial')
    where full_name = 'Julio';
