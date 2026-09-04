-- ============================================================================
-- agent_team: um agente pode pertencer a mais de uma equipe.
-- Usado pelo widechat-webhook pra saber quem é da equipe Comercial (e, no
-- futuro, filtrar/puxar conversas de outras equipes como Secretaria).
-- ============================================================================

CREATE TABLE agent_team (
  agent_id uuid NOT NULL REFERENCES agent_profiles(id) ON DELETE CASCADE,
  team_id  uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, team_id)
);
CREATE INDEX idx_agent_team_team ON agent_team (team_id);

-- migra o team_id único que já existia em agent_profiles
INSERT INTO agent_team (agent_id, team_id)
  SELECT id, team_id FROM agent_profiles WHERE team_id IS NOT NULL
  ON CONFLICT DO NOTHING;

ALTER TABLE agent_team ENABLE ROW LEVEL SECURITY;
CREATE POLICY agent_team_sel ON agent_team FOR SELECT USING (public.is_staff());
CREATE POLICY agent_team_all ON agent_team FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- nomes (lowercase, trim) dos agentes ativos de um conjunto de equipes —
-- usado pelo widechat-webhook pra decidir se o agente é "comercial".
CREATE OR REPLACE FUNCTION agent_names_in_teams(p_teams text[])
RETURNS TABLE(name text)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT DISTINCT lower(trim(ap.name))
  FROM agent_profiles ap
  JOIN agent_team at ON at.agent_id = ap.id
  JOIN teams t ON t.id = at.team_id
  WHERE t.name = ANY(p_teams) AND ap.active;
$$;
GRANT EXECUTE ON FUNCTION agent_names_in_teams(text[]) TO service_role, authenticated;
