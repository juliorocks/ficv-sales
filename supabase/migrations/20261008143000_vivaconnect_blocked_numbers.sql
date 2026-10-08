-- Lista de bloqueio de números — pedido do usuário 08/10: excluir o lead/card não é
-- suficiente pra "fazer ele não voltar mais", porque qualquer mensagem nova desse
-- número cria um lead do zero de novo (ver vivaconnect-webhook/index.ts, admissão de
-- lead novo). Caso real: "558330417471" é o número do Hub do Grupo da própria FICV
-- (cadastrado por engano como telefone da aluna Nilda), virou um loop bot-contra-bot
-- (ver fix anterior em ticket-emails) e o card reaparecia mesmo depois de excluído.
-- O webhook agora ignora qualquer mensagem desses números ANTES de criar/reabrir lead.
create table public.vivaconnect_blocked_numbers (
    number text primary key,
    reason text,
    created_by uuid references public.profiles(id),
    created_at timestamptz not null default now()
);

alter table public.vivaconnect_blocked_numbers enable row level security;

create policy vivaconnect_blocked_numbers_admin on public.vivaconnect_blocked_numbers
    for all using (public.is_admin()) with check (public.is_admin());

insert into public.vivaconnect_blocked_numbers (number, reason)
values ('558330417471', 'Número do Hub do Grupo da própria FICV, cadastrado por engano como telefone de uma aluna — causava loop bot-contra-bot (Vivi x bot do Hub).');
