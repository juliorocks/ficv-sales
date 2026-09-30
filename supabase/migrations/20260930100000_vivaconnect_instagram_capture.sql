-- Suporte "modo captura" pro canal Instagram (pedido do usuário 30/09: "claro que eu quero o
-- Instagram também"). Passo 1 de construir o suporte de verdade: deixar cadastrar o canal
-- (kind='instagram') pra o webhook conseguir GRAVAR o payload bruto real de uma mensagem do
-- Instagram (vivaconnect_webhook_logs) — o formato nunca foi visto, então o parser/lead-match
-- ainda não dá pra adaptar às cegas. O webhook (vivaconnect-webhook/index.ts) já para
-- explicitamente antes de tentar processar como WhatsApp quando kind='instagram' — só loga.
alter table public.vivaconnect_channels drop constraint if exists vivaconnect_channels_kind_check;
alter table public.vivaconnect_channels add constraint vivaconnect_channels_kind_check
  check (kind in ('waba', 'baileys', 'hybrid', 'instagram'));
