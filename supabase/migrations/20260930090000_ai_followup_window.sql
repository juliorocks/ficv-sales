-- Janela de horário pro follow-up automático da IA (reengajar + encerrar sozinho) — pedido
-- do usuário 30/09: mensagens estavam saindo de madrugada (03:30, 07:45) porque o gate de
-- horário existente (vivaconnect_settings.send_window_start/end) está configurado como 0-24
-- (sem restrição, pensado pra outros tipos de envio) e o encerramento automático
-- (runFollowupGiveups) nem tinha gate nenhum. Campo dedicado, ajustável no painel (IA de
-- Atendimento), padrão horário comercial.
alter table public.ai_agent_settings
  add column if not exists followup_window_start smallint not null default 8,
  add column if not exists followup_window_end   smallint not null default 20;

comment on column public.ai_agent_settings.followup_window_start is 'Hora (0-23, America/Sao_Paulo) a partir da qual o follow-up automático (reengajar + encerrar sozinho) pode disparar.';
comment on column public.ai_agent_settings.followup_window_end   is 'Hora (1-24) até a qual o follow-up automático pode disparar (exclusiva: 20 = até 19h59).';
