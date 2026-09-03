-- ============================================================================
-- RLS — Row Level Security
-- Papéis: staff = profiles.role IN ('admin','agent'); admin = 'admin'.
-- Edge Functions usam service_role → ignoram RLS.
-- ============================================================================

-- Helpers SECURITY DEFINER (evitam recursão de policy em profiles)
CREATE OR REPLACE FUNCTION public.is_staff() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','agent'));
$$;
CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin');
$$;
GRANT EXECUTE ON FUNCTION public.is_staff() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- helper macro via DO: habilita RLS + policies padrão
--   modo 'staff_rw_admin_del' : staff lê/cria/atualiza, admin deleta
--   modo 'auth_read_admin_write': staff lê, admin cria/atualiza/deleta
DO $$
DECLARE
  t text;
  staff_rw_admin_del text[] := ARRAY['leads','lead_notes','lead_history','messages_logs','upload_logs',
                                     'widechat_messages','widechat_raw_messages','widechat_atendimentos',
                                     'widechat_webhook_logs','sendpulse_webhook_logs'];
  auth_read_admin_write text[] := ARRAY['stages','courses','lead_sources','motivos_perda','teams',
                                        'scripts','knowledge_base','app_settings','financial_goals',
                                        'agent_profiles','agent_reports',
                                        'meta_campaigns','meta_campaign_insights_daily','meta_demographics_daily',
                                        'meta_account_stats','google_ads_campaigns','google_ads_insights_daily',
                                        'sponte_matriculas','sponte_parcelas','matriculas',
                                        'partners','referral_clicks','sendpulse_forms'];
BEGIN
  FOREACH t IN ARRAY staff_rw_admin_del LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (public.is_staff())', t||'_sel', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR INSERT WITH CHECK (public.is_staff())', t||'_ins', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE USING (public.is_staff())', t||'_upd', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR DELETE USING (public.is_admin())', t||'_del', t);
  END LOOP;
  FOREACH t IN ARRAY auth_read_admin_write LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (public.is_staff())', t||'_sel', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin())', t||'_admin', t);
  END LOOP;
END $$;

-- profiles: staff lê todos; cada um edita o seu, admin edita qualquer
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY profiles_sel ON profiles FOR SELECT USING (public.is_staff() OR id = auth.uid());
CREATE POLICY profiles_upd ON profiles FOR UPDATE USING (id = auth.uid() OR public.is_admin());
CREATE POLICY profiles_ins ON profiles FOR INSERT WITH CHECK (id = auth.uid() OR public.is_admin());
CREATE POLICY profiles_del ON profiles FOR DELETE USING (public.is_admin());

-- alunos: staff lê todos; aluno lê/edita/insere o seu
ALTER TABLE alunos ENABLE ROW LEVEL SECURITY;
CREATE POLICY alunos_staff_all ON alunos FOR SELECT USING (public.is_staff());
CREATE POLICY alunos_self_sel  ON alunos FOR SELECT USING (id = auth.uid());
CREATE POLICY alunos_self_upd  ON alunos FOR UPDATE USING (id = auth.uid() OR public.is_staff());
CREATE POLICY alunos_self_ins  ON alunos FOR INSERT WITH CHECK (id = auth.uid());

-- audit_logs: staff lê; qualquer autenticado insere
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_sel ON audit_logs FOR SELECT USING (public.is_staff());
CREATE POLICY audit_ins ON audit_logs FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- user_integrations: cada um só vê/edita as suas credenciais WideChat
ALTER TABLE user_integrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY ui_self ON user_integrations FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ── Tickets (Central de Atendimento) ───────────────────────────────────────
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_evaluations ENABLE ROW LEVEL SECURITY;

CREATE POLICY tickets_select ON tickets FOR SELECT
  USING (aluno_id = auth.uid() OR public.is_staff());
CREATE POLICY tickets_insert ON tickets FOR INSERT WITH CHECK (aluno_id = auth.uid());
CREATE POLICY tickets_update ON tickets FOR UPDATE
  USING (aluno_id = auth.uid() OR public.is_staff());

CREATE POLICY tmsg_select ON ticket_messages FOR SELECT USING (
  (EXISTS (SELECT 1 FROM tickets WHERE id = ticket_id AND aluno_id = auth.uid()) AND interno = false)
  OR public.is_staff()
);
CREATE POLICY tmsg_insert ON ticket_messages FOR INSERT WITH CHECK (autor_id = auth.uid());

CREATE POLICY teval_insert ON ticket_evaluations FOR INSERT WITH CHECK (aluno_id = auth.uid());
CREATE POLICY teval_select ON ticket_evaluations FOR SELECT
  USING (aluno_id = auth.uid() OR public.is_staff());
