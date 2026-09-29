-- vivaconnect_channels tem RLS admin-only (api_token é segredo em texto puro na mesma
-- linha — nunca dar SELECT direto na tabela pra staff comum, [[feedback_no_secret_columns]]).
-- O selo de canal no card do Kanban (29/09) precisa só de id/name/phone pra qualquer
-- atendente (is_staff = admin/agent) — RPC SECURITY DEFINER devolvendo só essas colunas,
-- mesmo padrão de inbox_leads/ticket_visible.
CREATE OR REPLACE FUNCTION public.vivaconnect_channels_lookup()
RETURNS TABLE (id bigint, name text, phone text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id, c.name, c.phone FROM vivaconnect_channels c WHERE public.is_staff();
$$;
GRANT EXECUTE ON FUNCTION public.vivaconnect_channels_lookup() TO authenticated;
