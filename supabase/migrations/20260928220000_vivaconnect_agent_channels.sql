-- ============================================================================
-- VivaConnect: quais canais cada agente está apto a receber/enviar (28/09) — pedido
-- explícito do usuário: "escolher quais canais cada agente está apto a receber e
-- enviar, dentro do nosso painel". Sem nenhuma linha pra um agente = sem restrição
-- (comportamento de hoje, vê/manda em qualquer canal); a partir da 1ª linha, ele só
-- vê/manda nos canais listados (+ leads sem canal do VivaConnect, de outras origens).
-- ============================================================================

CREATE TABLE IF NOT EXISTS vivaconnect_agent_channels (
  profile_id  uuid   NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  channel_id  bigint NOT NULL REFERENCES vivaconnect_channels(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, channel_id)
);
CREATE INDEX IF NOT EXISTS vivaconnect_agent_channels_profile ON vivaconnect_agent_channels (profile_id);

ALTER TABLE vivaconnect_agent_channels ENABLE ROW LEVEL SECURITY;
-- staff lê a própria restrição (pro Kanban filtrar sozinho); admin lê/edita tudo
-- (tela de Gestão > VivaConnect monta a matriz agente × canal).
DROP POLICY IF EXISTS vivaconnect_agent_channels_sel ON vivaconnect_agent_channels;
CREATE POLICY vivaconnect_agent_channels_sel ON vivaconnect_agent_channels
  FOR SELECT USING (public.is_admin() OR profile_id = auth.uid());
DROP POLICY IF EXISTS vivaconnect_agent_channels_admin ON vivaconnect_agent_channels;
CREATE POLICY vivaconnect_agent_channels_admin ON vivaconnect_agent_channels
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
