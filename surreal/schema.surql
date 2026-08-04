-- ============================================================
-- SALESPULSE — Schema SurrealDB
-- Migração paralela do Supabase → SurrealDB Cloud
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- NAMESPACES e DATABASE (criar via dashboard ou run antes)
-- DEFINE NAMESPACE ficv;
-- USE NAMESPACE ficv;
-- DEFINE DATABASE salespulse;
-- USE DATABASE salespulse;
-- ──────────────────────────────────────────────────────────────

-- ============================================================
-- AUTENTICAÇÃO
-- 2 pools: staff (admin/agent) e alunos (students)
-- ============================================================

-- Staff: admin e atendentes (equivale a Supabase auth.users + profiles)
DEFINE ACCESS staff ON DATABASE TYPE RECORD
  SIGNUP (
    CREATE profiles SET
      email    = $email,
      password = crypto::argon2::generate($password),
      full_name = $full_name,
      role     = 'agent',
      active   = true,
      created_at = time::now()
  )
  SIGNIN (
    SELECT * FROM profiles
    WHERE email = $email
    AND crypto::argon2::compare(password, $password)
    AND active = true
  )
  DURATION FOR TOKEN 8h, FOR SESSION 24h;

-- Alunos: portal do aluno (equivale a Supabase auth.users com role aluno)
DEFINE ACCESS alunos ON DATABASE TYPE RECORD
  SIGNUP (
    CREATE alunos SET
      email    = $email,
      password = crypto::argon2::generate($password),
      cpf      = $cpf,
      nome     = $nome,
      created_at = time::now(),
      updated_at = time::now()
  )
  SIGNIN (
    SELECT * FROM alunos
    WHERE email = $email
    AND crypto::argon2::compare(password, $password)
  )
  DURATION FOR TOKEN 24h, FOR SESSION 7d;

-- ============================================================
-- HELPERS
-- ============================================================

DEFINE FUNCTION fn::normalize_name($name: string) {
  RETURN string::lowercase(
    string::replace(
      string::replace(
        string::replace(
          string::replace(
            string::replace($name, 'ã', 'a'),
            'ç', 'c'),
          'ê', 'e'),
        'á', 'a'),
      'õ', 'o')
  );
};

-- ============================================================
-- TABELA: profiles (staff — admin e agentes)
-- ============================================================

DEFINE TABLE profiles SCHEMAFULL
  PERMISSIONS
    FOR select WHERE $auth.id != NONE,
    FOR create, update WHERE $auth.role = 'admin',
    FOR delete WHERE $auth.role = 'admin';

DEFINE FIELD email       ON profiles TYPE string ASSERT string::is_email($value);
DEFINE FIELD password    ON profiles TYPE string;
DEFINE FIELD full_name   ON profiles TYPE string;
DEFINE FIELD role        ON profiles TYPE string ASSERT $value IN ['admin', 'agent', 'atendente', 'visualizador'] DEFAULT 'agent';
DEFINE FIELD avatar_url  ON profiles TYPE option<string>;
DEFINE FIELD active      ON profiles TYPE bool DEFAULT true;
DEFINE FIELD created_at  ON profiles TYPE datetime DEFAULT time::now();
DEFINE FIELD updated_at  ON profiles TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_profiles_email ON profiles FIELDS email UNIQUE;

-- ============================================================
-- TABELA: alunos (portal do aluno)
-- ============================================================

DEFINE TABLE alunos SCHEMAFULL
  PERMISSIONS
    FOR select WHERE $auth.id = id OR $auth.role = 'admin' OR $auth.role = 'atendente',
    FOR create WHERE $auth.id != NONE,
    FOR update WHERE $auth.id = id OR $auth.role = 'admin',
    FOR delete WHERE $auth.role = 'admin';

DEFINE FIELD cpf        ON alunos TYPE string;
DEFINE FIELD nome       ON alunos TYPE string;
DEFINE FIELD email      ON alunos TYPE string ASSERT string::is_email($value);
DEFINE FIELD password   ON alunos TYPE string;
DEFINE FIELD created_at ON alunos TYPE datetime DEFAULT time::now();
DEFINE FIELD updated_at ON alunos TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_alunos_cpf   ON alunos FIELDS cpf UNIQUE;
DEFINE INDEX idx_alunos_email ON alunos FIELDS email UNIQUE;

-- ============================================================
-- TABELA: stages (funil de vendas)
-- ============================================================

DEFINE TABLE stages SCHEMAFULL
  PERMISSIONS
    FOR select WHERE $auth.id != NONE,
    FOR create, update, delete WHERE $auth.role = 'admin';

DEFINE FIELD name        ON stages TYPE string;
DEFINE FIELD order       ON stages TYPE int DEFAULT 0;
DEFINE FIELD title_color ON stages TYPE option<string>;
DEFINE FIELD bg_color    ON stages TYPE option<string>;

-- ============================================================
-- TABELA: courses
-- ============================================================

DEFINE TABLE courses SCHEMAFULL
  PERMISSIONS
    FOR select WHERE $auth.id != NONE,
    FOR create, update, delete WHERE $auth.role = 'admin';

DEFINE FIELD name          ON courses TYPE string;
DEFINE FIELD type          ON courses TYPE string;
DEFINE FIELD default_value ON courses TYPE option<decimal>;

-- ============================================================
-- TABELA: lead_sources
-- ============================================================

DEFINE TABLE lead_sources SCHEMAFULL
  PERMISSIONS
    FOR select WHERE $auth.id != NONE,
    FOR create, update, delete WHERE $auth.role = 'admin';

DEFINE FIELD name  ON lead_sources TYPE string;
DEFINE FIELD icon  ON lead_sources TYPE string;
DEFINE FIELD color ON lead_sources TYPE string DEFAULT '#6366f1';

-- ============================================================
-- TABELA: motivos_perda
-- ============================================================

DEFINE TABLE motivos_perda SCHEMAFULL
  PERMISSIONS
    FOR select WHERE $auth.id != NONE,
    FOR create, update, delete WHERE $auth.role = 'admin';

DEFINE FIELD motivo ON motivos_perda TYPE string;

-- ============================================================
-- TABELA: teams
-- ============================================================

DEFINE TABLE teams SCHEMAFULL
  PERMISSIONS
    FOR select WHERE $auth.id != NONE,
    FOR create, update, delete WHERE $auth.role = 'admin';

DEFINE FIELD name        ON teams TYPE string;
DEFINE FIELD description ON teams TYPE option<string>;
DEFINE FIELD color       ON teams TYPE string DEFAULT '#6366f1';
DEFINE FIELD icon        ON teams TYPE string DEFAULT 'users';
DEFINE FIELD active      ON teams TYPE bool DEFAULT true;
DEFINE FIELD created_at  ON teams TYPE datetime DEFAULT time::now();
DEFINE FIELD updated_at  ON teams TYPE datetime DEFAULT time::now();

-- ============================================================
-- TABELA: leads (CRM principal)
-- ============================================================

DEFINE TABLE leads SCHEMAFULL
  PERMISSIONS
    FOR select WHERE $auth.id != NONE,
    FOR create WHERE $auth.id != NONE,
    FOR update WHERE $auth.id != NONE,
    FOR delete WHERE $auth.role = 'admin';

DEFINE FIELD nome_completo           ON leads TYPE string;
DEFINE FIELD email                   ON leads TYPE option<string>;
DEFINE FIELD telefone                ON leads TYPE string;
DEFINE FIELD curso_interesse         ON leads TYPE option<record<courses>>;
DEFINE FIELD valor_oportunidade      ON leads TYPE decimal DEFAULT 0;
DEFINE FIELD stage_id                ON leads TYPE record<stages>;
DEFINE FIELD data_entrada            ON leads TYPE datetime DEFAULT time::now();
DEFINE FIELD stage_entry_date        ON leads TYPE option<datetime>;
DEFINE FIELD observacoes             ON leads TYPE option<string>;
DEFINE FIELD attachments             ON leads TYPE option<array<string>>;
DEFINE FIELD source_id               ON leads TYPE option<record<lead_sources>>;
DEFINE FIELD temperatura             ON leads TYPE option<string> ASSERT $value = NONE OR $value IN ['frio', 'morno', 'quente'];
DEFINE FIELD assigned_to_id          ON leads TYPE option<record<profiles>>;
DEFINE FIELD motivo_perda_id         ON leads TYPE option<record<motivos_perda>>;
DEFINE FIELD contact_count           ON leads TYPE int DEFAULT 0;
DEFINE FIELD widechat_contact_id     ON leads TYPE option<string>;
DEFINE FIELD widechat_session_id     ON leads TYPE option<string>;
DEFINE FIELD widechat_attendance_id  ON leads TYPE option<string>;
DEFINE FIELD fonte_lead              ON leads TYPE option<string>;
DEFINE FIELD partner_id              ON leads TYPE option<string>;
DEFINE FIELD created_at              ON leads TYPE datetime DEFAULT time::now();
DEFINE FIELD updated_at              ON leads TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_leads_telefone     ON leads FIELDS telefone;
DEFINE INDEX idx_leads_stage        ON leads FIELDS stage_id;
DEFINE INDEX idx_leads_assigned     ON leads FIELDS assigned_to_id;
DEFINE INDEX idx_leads_widechat     ON leads FIELDS widechat_contact_id;

-- ============================================================
-- TABELA: lead_history
-- ============================================================

DEFINE TABLE lead_history SCHEMAFULL
  PERMISSIONS
    FOR select WHERE $auth.id != NONE,
    FOR create WHERE $auth.id != NONE,
    FOR update, delete WHERE $auth.role = 'admin';

DEFINE FIELD lead_id       ON lead_history TYPE record<leads>;
DEFINE FIELD from_stage_id ON lead_history TYPE option<record<stages>>;
DEFINE FIELD to_stage_id   ON lead_history TYPE record<stages>;
DEFINE FIELD changed_at    ON lead_history TYPE datetime DEFAULT time::now();
DEFINE FIELD changed_by    ON lead_history TYPE record<profiles>;
DEFINE FIELD motivo_perda_id ON lead_history TYPE option<record<motivos_perda>>;

DEFINE INDEX idx_lead_history_lead ON lead_history FIELDS lead_id;

-- ============================================================
-- TABELA: lead_notes
-- ============================================================

DEFINE TABLE lead_notes SCHEMAFULL
  PERMISSIONS
    FOR select WHERE $auth.id != NONE,
    FOR create WHERE $auth.id != NONE,
    FOR update WHERE created_by = $auth.id OR $auth.role = 'admin',
    FOR delete WHERE created_by = $auth.id OR $auth.role = 'admin';

DEFINE FIELD lead_id    ON lead_notes TYPE record<leads>;
DEFINE FIELD note       ON lead_notes TYPE string;
DEFINE FIELD created_at ON lead_notes TYPE datetime DEFAULT time::now();
DEFINE FIELD created_by ON lead_notes TYPE record<profiles>;

DEFINE INDEX idx_lead_notes_lead ON lead_notes FIELDS lead_id;

-- ============================================================
-- TABELA: audit_logs
-- ============================================================

DEFINE TABLE audit_logs SCHEMAFULL
  PERMISSIONS
    FOR select WHERE $auth.role = 'admin',
    FOR create WHERE $auth.id != NONE,
    FOR update, delete FULL;

DEFINE FIELD created_at ON audit_logs TYPE datetime DEFAULT time::now();
DEFINE FIELD user_id    ON audit_logs TYPE option<record<profiles>>;
DEFINE FIELD action     ON audit_logs TYPE string;
DEFINE FIELD details    ON audit_logs TYPE object;

DEFINE INDEX idx_audit_created ON audit_logs FIELDS created_at;

-- ============================================================
-- TABELA: app_settings
-- ============================================================

DEFINE TABLE app_settings SCHEMAFULL
  PERMISSIONS
    FOR select WHERE $auth.id != NONE,
    FOR create, update, delete WHERE $auth.role = 'admin';

DEFINE FIELD key       ON app_settings TYPE string;
DEFINE FIELD value     ON app_settings TYPE any;
DEFINE FIELD updated_at ON app_settings TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_app_settings_key ON app_settings FIELDS key UNIQUE;

-- ============================================================
-- TABELA: financial_goals
-- ============================================================

DEFINE TABLE financial_goals SCHEMAFULL
  PERMISSIONS
    FOR select WHERE $auth.id != NONE,
    FOR create, update, delete WHERE $auth.role = 'admin';

DEFINE FIELD month      ON financial_goals TYPE string; -- formato: YYYY-MM
DEFINE FIELD goal_value ON financial_goals TYPE decimal DEFAULT 0;
DEFINE FIELD created_at ON financial_goals TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_financial_goals_month ON financial_goals FIELDS month UNIQUE;

-- ============================================================
-- TABELA: agent_profiles
-- ============================================================

DEFINE TABLE agent_profiles SCHEMAFULL
  PERMISSIONS
    FOR select WHERE $auth.id != NONE,
    FOR create, update, delete WHERE $auth.role = 'admin';

DEFINE FIELD profile_id   ON agent_profiles TYPE record<profiles>;
DEFINE FIELD score_target ON agent_profiles TYPE decimal DEFAULT 0;
DEFINE FIELD phone        ON agent_profiles TYPE option<string>;
DEFINE FIELD notes        ON agent_profiles TYPE option<string>;
DEFINE FIELD team_id      ON agent_profiles TYPE option<record<teams>>;
DEFINE FIELD active       ON agent_profiles TYPE bool DEFAULT true;

DEFINE INDEX idx_agent_profiles_profile ON agent_profiles FIELDS profile_id UNIQUE;

-- ============================================================
-- TABELA: agent_reports
-- ============================================================

DEFINE TABLE agent_reports SCHEMAFULL
  PERMISSIONS
    FOR select WHERE $auth.id != NONE,
    FOR create, update, delete WHERE $auth.role = 'admin';

DEFINE FIELD profile_id   ON agent_reports TYPE record<profiles>;
DEFINE FIELD period_start ON agent_reports TYPE datetime;
DEFINE FIELD period_end   ON agent_reports TYPE datetime;
DEFINE FIELD metrics      ON agent_reports TYPE object;
DEFINE FIELD created_at   ON agent_reports TYPE datetime DEFAULT time::now();

-- ============================================================
-- TABELA: scripts (scripts de venda)
-- ============================================================

DEFINE TABLE scripts SCHEMAFULL
  PERMISSIONS
    FOR select WHERE $auth.id != NONE,
    FOR create, update, delete WHERE $auth.role = 'admin';

DEFINE FIELD title      ON scripts TYPE string;
DEFINE FIELD content    ON scripts TYPE string;
DEFINE FIELD category   ON scripts TYPE option<string>;
DEFINE FIELD active     ON scripts TYPE bool DEFAULT true;
DEFINE FIELD created_at ON scripts TYPE datetime DEFAULT time::now();
DEFINE FIELD updated_at ON scripts TYPE datetime DEFAULT time::now();

-- ============================================================
-- TABELA: knowledge_base
-- ============================================================

DEFINE TABLE knowledge_base SCHEMAFULL
  PERMISSIONS
    FOR select WHERE $auth.id != NONE,
    FOR create, update, delete WHERE $auth.role = 'admin';

DEFINE FIELD title      ON knowledge_base TYPE string;
DEFINE FIELD content    ON knowledge_base TYPE string;
DEFINE FIELD category   ON knowledge_base TYPE option<string>;
DEFINE FIELD tags       ON knowledge_base TYPE option<array<string>>;
DEFINE FIELD active     ON knowledge_base TYPE bool DEFAULT true;
DEFINE FIELD created_at ON knowledge_base TYPE datetime DEFAULT time::now();
DEFINE FIELD updated_at ON knowledge_base TYPE datetime DEFAULT time::now();

-- ============================================================
-- MÓDULO TICKETS
-- ============================================================

DEFINE TABLE tickets SCHEMAFULL
  PERMISSIONS
    FOR select WHERE
      $auth.id = aluno_id OR
      $auth.id = atendente_id OR
      $auth.role IN ['admin', 'atendente'],
    FOR create WHERE $auth.id != NONE,
    FOR update WHERE
      $auth.id = atendente_id OR $auth.role = 'admin',
    FOR delete WHERE $auth.role = 'admin';

DEFINE FIELD protocolo         ON tickets TYPE string;
DEFINE FIELD titulo            ON tickets TYPE string;
DEFINE FIELD categoria         ON tickets TYPE string ASSERT $value IN ['financeiro','academico','secretaria','suporte_tecnico','certificado','cancelamento','outros'];
DEFINE FIELD prioridade        ON tickets TYPE string ASSERT $value IN ['baixa','media','alta','urgente'] DEFAULT 'media';
DEFINE FIELD status            ON tickets TYPE string ASSERT $value IN ['aberto','em_atendimento','aguardando_aluno','resolvido','fechado'] DEFAULT 'aberto';
DEFINE FIELD aluno_id          ON tickets TYPE record<alunos>;
DEFINE FIELD aluno_nome        ON tickets TYPE string;
DEFINE FIELD aluno_email       ON tickets TYPE string;
DEFINE FIELD atendente_id      ON tickets TYPE option<record<profiles>>;
DEFINE FIELD curso_id          ON tickets TYPE option<record<courses>>;
DEFINE FIELD created_at        ON tickets TYPE datetime DEFAULT time::now();
DEFINE FIELD updated_at        ON tickets TYPE datetime DEFAULT time::now();
DEFINE FIELD first_response_at ON tickets TYPE option<datetime>;
DEFINE FIELD resolved_at       ON tickets TYPE option<datetime>;
DEFINE FIELD avaliado          ON tickets TYPE bool DEFAULT false;

DEFINE INDEX idx_tickets_protocolo ON tickets FIELDS protocolo UNIQUE;
DEFINE INDEX idx_tickets_aluno     ON tickets FIELDS aluno_id;
DEFINE INDEX idx_tickets_status    ON tickets FIELDS status;

-- Event: auto-update updated_at
DEFINE EVENT tickets_updated ON tickets WHEN $event = 'UPDATE' THEN {
  UPDATE $after.id SET updated_at = time::now();
};

-- ──────────────────────────────────────────────────────────────
DEFINE TABLE ticket_messages SCHEMAFULL
  PERMISSIONS
    FOR select WHERE $auth.id != NONE,
    FOR create WHERE $auth.id != NONE,
    FOR update, delete WHERE $auth.role = 'admin';

DEFINE FIELD ticket_id  ON ticket_messages TYPE record<tickets>;
DEFINE FIELD autor_id   ON ticket_messages TYPE string; -- pode ser aluno ou profiles
DEFINE FIELD autor_nome ON ticket_messages TYPE string;
DEFINE FIELD autor_role ON ticket_messages TYPE string ASSERT $value IN ['aluno','atendente','admin'];
DEFINE FIELD conteudo   ON ticket_messages TYPE string;
DEFINE FIELD interno    ON ticket_messages TYPE bool DEFAULT false;
DEFINE FIELD created_at ON ticket_messages TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_ticket_msg_ticket ON ticket_messages FIELDS ticket_id;

-- ──────────────────────────────────────────────────────────────
DEFINE TABLE ticket_evaluations SCHEMAFULL
  PERMISSIONS
    FOR select WHERE $auth.id != NONE,
    FOR create WHERE $auth.id != NONE,
    FOR update, delete WHERE $auth.role = 'admin';

DEFINE FIELD ticket_id    ON ticket_evaluations TYPE record<tickets>;
DEFINE FIELD aluno_id     ON ticket_evaluations TYPE record<alunos>;
DEFINE FIELD csat_nota    ON ticket_evaluations TYPE int ASSERT $value >= 1 AND $value <= 5;
DEFINE FIELD ces_nota     ON ticket_evaluations TYPE int ASSERT $value >= 1 AND $value <= 7;
DEFINE FIELD fcr_resolvido ON ticket_evaluations TYPE bool;
DEFINE FIELD nps_nota     ON ticket_evaluations TYPE option<int> ASSERT $value = NONE OR ($value >= 0 AND $value <= 10);
DEFINE FIELD comentario   ON ticket_evaluations TYPE option<string>;
DEFINE FIELD created_at   ON ticket_evaluations TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_ticket_eval_ticket ON ticket_evaluations FIELDS ticket_id UNIQUE;

-- ============================================================
-- MÓDULO PARCEIROS
-- ============================================================

DEFINE TABLE partners SCHEMAFULL
  PERMISSIONS
    FOR select WHERE $auth.id != NONE,
    FOR create, update, delete WHERE $auth.role = 'admin';

DEFINE FIELD name             ON partners TYPE string;
DEFINE FIELD slug             ON partners TYPE string;
DEFINE FIELD type             ON partners TYPE string ASSERT $value IN ['influencer','polo','other'];
DEFINE FIELD target_url       ON partners TYPE option<string>;
DEFINE FIELD social_media_url ON partners TYPE option<string>;
DEFINE FIELD coupon           ON partners TYPE option<string>;
DEFINE FIELD active           ON partners TYPE bool DEFAULT true;
DEFINE FIELD created_at       ON partners TYPE datetime DEFAULT time::now();
DEFINE FIELD updated_at       ON partners TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_partners_slug ON partners FIELDS slug UNIQUE;

-- ──────────────────────────────────────────────────────────────
DEFINE TABLE referral_clicks SCHEMAFULL
  PERMISSIONS
    FOR select WHERE $auth.role = 'admin',
    FOR create FULL, -- webhook sem auth
    FOR update, delete WHERE $auth.role = 'admin';

DEFINE FIELD partner_id ON referral_clicks TYPE record<partners>;
DEFINE FIELD ip_address ON referral_clicks TYPE option<string>;
DEFINE FIELD user_agent ON referral_clicks TYPE option<string>;
DEFINE FIELD referrer   ON referral_clicks TYPE option<string>;
DEFINE FIELD metadata   ON referral_clicks TYPE option<object>;
DEFINE FIELD created_at ON referral_clicks TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_referral_partner ON referral_clicks FIELDS partner_id;

-- ============================================================
-- MÓDULO MARKETING — META ADS
-- ============================================================

DEFINE TABLE meta_campaigns SCHEMAFULL
  PERMISSIONS
    FOR select WHERE $auth.id != NONE,
    FOR create, update, delete WHERE $auth.role = 'admin';

DEFINE FIELD campaign_id ON meta_campaigns TYPE string;
DEFINE FIELD name        ON meta_campaigns TYPE string;
DEFINE FIELD objective   ON meta_campaigns TYPE option<string>;
DEFINE FIELD status      ON meta_campaigns TYPE option<string>;
DEFINE FIELD updated_at  ON meta_campaigns TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_meta_campaigns_id ON meta_campaigns FIELDS campaign_id UNIQUE;

-- ──────────────────────────────────────────────────────────────
DEFINE TABLE meta_campaign_insights_daily SCHEMAFULL
  PERMISSIONS
    FOR select WHERE $auth.id != NONE,
    FOR create, update, delete WHERE $auth.role = 'admin';

DEFINE FIELD campaign_id   ON meta_campaign_insights_daily TYPE string;
DEFINE FIELD campaign_name ON meta_campaign_insights_daily TYPE option<string>;
DEFINE FIELD date          ON meta_campaign_insights_daily TYPE string;
DEFINE FIELD spend         ON meta_campaign_insights_daily TYPE decimal DEFAULT 0;
DEFINE FIELD impressions   ON meta_campaign_insights_daily TYPE int DEFAULT 0;
DEFINE FIELD clicks        ON meta_campaign_insights_daily TYPE int DEFAULT 0;
DEFINE FIELD reach         ON meta_campaign_insights_daily TYPE int DEFAULT 0;
DEFINE FIELD frequency     ON meta_campaign_insights_daily TYPE decimal DEFAULT 0;
DEFINE FIELD ctr           ON meta_campaign_insights_daily TYPE decimal DEFAULT 0;
DEFINE FIELD cpm           ON meta_campaign_insights_daily TYPE decimal DEFAULT 0;
DEFINE FIELD leads_count   ON meta_campaign_insights_daily TYPE int DEFAULT 0;
DEFINE FIELD actions_raw   ON meta_campaign_insights_daily TYPE option<object>;
DEFINE FIELD synced_at     ON meta_campaign_insights_daily TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_meta_insights_date     ON meta_campaign_insights_daily FIELDS date;
DEFINE INDEX idx_meta_insights_camp_date ON meta_campaign_insights_daily FIELDS campaign_id, date UNIQUE;

-- ──────────────────────────────────────────────────────────────
DEFINE TABLE meta_demographics_daily SCHEMAFULL
  PERMISSIONS
    FOR select WHERE $auth.id != NONE,
    FOR create, update, delete WHERE $auth.role = 'admin';

DEFINE FIELD date        ON meta_demographics_daily TYPE string;
DEFINE FIELD age_range   ON meta_demographics_daily TYPE option<string>;
DEFINE FIELD gender      ON meta_demographics_daily TYPE option<string>;
DEFINE FIELD spend       ON meta_demographics_daily TYPE decimal DEFAULT 0;
DEFINE FIELD impressions ON meta_demographics_daily TYPE int DEFAULT 0;
DEFINE FIELD clicks      ON meta_demographics_daily TYPE int DEFAULT 0;
DEFINE FIELD leads_count ON meta_demographics_daily TYPE int DEFAULT 0;
DEFINE FIELD synced_at   ON meta_demographics_daily TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_meta_demo_date ON meta_demographics_daily FIELDS date;
DEFINE INDEX idx_meta_demo_uniq ON meta_demographics_daily FIELDS date, age_range, gender UNIQUE;

-- ──────────────────────────────────────────────────────────────
DEFINE TABLE meta_account_stats SCHEMAFULL
  PERMISSIONS
    FOR select WHERE $auth.id != NONE,
    FOR create, update, delete WHERE $auth.role = 'admin';

DEFINE FIELD date       ON meta_account_stats TYPE datetime;
DEFINE FIELD spend      ON meta_account_stats TYPE decimal DEFAULT 0;
DEFINE FIELD metrics    ON meta_account_stats TYPE option<object>;
DEFINE FIELD synced_at  ON meta_account_stats TYPE datetime DEFAULT time::now();

-- ============================================================
-- MÓDULO MARKETING — GOOGLE ADS
-- ============================================================

DEFINE TABLE google_ads_campaigns SCHEMAFULL
  PERMISSIONS
    FOR select WHERE $auth.id != NONE,
    FOR create, update, delete WHERE $auth.role = 'admin';

DEFINE FIELD campaign_id              ON google_ads_campaigns TYPE string;
DEFINE FIELD campaign_name            ON google_ads_campaigns TYPE option<string>;
DEFINE FIELD status                   ON google_ads_campaigns TYPE option<string>;
DEFINE FIELD advertising_channel_type ON google_ads_campaigns TYPE option<string>;
DEFINE FIELD synced_at                ON google_ads_campaigns TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_gads_campaign_id ON google_ads_campaigns FIELDS campaign_id UNIQUE;

-- ──────────────────────────────────────────────────────────────
DEFINE TABLE google_ads_insights_daily SCHEMAFULL
  PERMISSIONS
    FOR select WHERE $auth.id != NONE,
    FOR create, update, delete WHERE $auth.role = 'admin';

DEFINE FIELD campaign_id   ON google_ads_insights_daily TYPE string;
DEFINE FIELD campaign_name ON google_ads_insights_daily TYPE option<string>;
DEFINE FIELD date          ON google_ads_insights_daily TYPE string;
DEFINE FIELD spend         ON google_ads_insights_daily TYPE decimal DEFAULT 0;
DEFINE FIELD impressions   ON google_ads_insights_daily TYPE int DEFAULT 0;
DEFINE FIELD clicks        ON google_ads_insights_daily TYPE int DEFAULT 0;
DEFINE FIELD conversions   ON google_ads_insights_daily TYPE decimal DEFAULT 0;
DEFINE FIELD synced_at     ON google_ads_insights_daily TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_gads_date     ON google_ads_insights_daily FIELDS date;
DEFINE INDEX idx_gads_camp_date ON google_ads_insights_daily FIELDS campaign_id, date UNIQUE;

-- ============================================================
-- MÓDULO SPONTE (matrículas importadas)
-- ============================================================

DEFINE TABLE sponte_matriculas SCHEMAFULL
  PERMISSIONS
    FOR select WHERE $auth.id != NONE,
    FOR create, update, delete WHERE $auth.role = 'admin';

DEFINE FIELD aluno         ON sponte_matriculas TYPE string;
DEFINE FIELD cpf           ON sponte_matriculas TYPE option<string>;
DEFINE FIELD celular       ON sponte_matriculas TYPE option<string>;
DEFINE FIELD nome_curso    ON sponte_matriculas TYPE string;
DEFINE FIELD nome_turma    ON sponte_matriculas TYPE option<string>;
DEFINE FIELD situacao      ON sponte_matriculas TYPE option<string>;
DEFINE FIELD data_matricula ON sponte_matriculas TYPE datetime;
DEFINE FIELD synced_at     ON sponte_matriculas TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_sponte_data    ON sponte_matriculas FIELDS data_matricula;
DEFINE INDEX idx_sponte_curso   ON sponte_matriculas FIELDS nome_curso;

-- ──────────────────────────────────────────────────────────────
DEFINE TABLE sponte_parcelas SCHEMAFULL
  PERMISSIONS
    FOR select WHERE $auth.id != NONE,
    FOR create, update, delete WHERE $auth.role = 'admin';

DEFINE FIELD aluno         ON sponte_parcelas TYPE string;
DEFINE FIELD cpf           ON sponte_parcelas TYPE option<string>;
DEFINE FIELD curso         ON sponte_parcelas TYPE option<string>;
DEFINE FIELD valor         ON sponte_parcelas TYPE decimal DEFAULT 0;
DEFINE FIELD vencimento    ON sponte_parcelas TYPE option<datetime>;
DEFINE FIELD status        ON sponte_parcelas TYPE option<string>;
DEFINE FIELD synced_at     ON sponte_parcelas TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_sponte_parcelas_aluno ON sponte_parcelas FIELDS aluno;

-- matriculas (simplificado — conversão via CRM)
DEFINE TABLE matriculas SCHEMAFULL
  PERMISSIONS
    FOR select WHERE $auth.id != NONE,
    FOR create, update WHERE $auth.id != NONE,
    FOR delete WHERE $auth.role = 'admin';

DEFINE FIELD cpf           ON matriculas TYPE string;
DEFINE FIELD nome          ON matriculas TYPE string;
DEFINE FIELD email         ON matriculas TYPE option<string>;
DEFINE FIELD telefone      ON matriculas TYPE option<string>;
DEFINE FIELD curso         ON matriculas TYPE option<string>;
DEFINE FIELD turma         ON matriculas TYPE option<string>;
DEFINE FIELD data_matricula ON matriculas TYPE option<datetime>;
DEFINE FIELD created_at    ON matriculas TYPE datetime DEFAULT time::now();
DEFINE FIELD updated_at    ON matriculas TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_matriculas_cpf  ON matriculas FIELDS cpf UNIQUE;
DEFINE INDEX idx_matriculas_data ON matriculas FIELDS data_matricula;

-- ============================================================
-- MÓDULO WIDECHAT (mensageria)
-- ============================================================

DEFINE TABLE widechat_messages SCHEMAFULL
  PERMISSIONS
    FOR select WHERE $auth.id != NONE,
    FOR create FULL,   -- webhook sem auth
    FOR update, delete WHERE $auth.role = 'admin';

DEFINE FIELD lead_id       ON widechat_messages TYPE option<record<leads>>;
DEFINE FIELD origin        ON widechat_messages TYPE string ASSERT $value IN ['agent','channel','auto'];
DEFINE FIELD sender_name   ON widechat_messages TYPE option<string>;
DEFINE FIELD content       ON widechat_messages TYPE option<string>;
DEFINE FIELD session_id    ON widechat_messages TYPE option<string>;
DEFINE FIELD contact_id    ON widechat_messages TYPE option<string>;
DEFINE FIELD created_at    ON widechat_messages TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_widechat_msg_lead    ON widechat_messages FIELDS lead_id;
DEFINE INDEX idx_widechat_msg_origin  ON widechat_messages FIELDS origin;
DEFINE INDEX idx_widechat_msg_created ON widechat_messages FIELDS created_at;

-- ──────────────────────────────────────────────────────────────
DEFINE TABLE widechat_raw_messages SCHEMAFULL
  PERMISSIONS
    FOR select WHERE $auth.id != NONE,
    FOR create FULL,
    FOR update, delete WHERE $auth.role = 'admin';

DEFINE FIELD payload    ON widechat_raw_messages TYPE object;
DEFINE FIELD created_at ON widechat_raw_messages TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_widechat_raw_created ON widechat_raw_messages FIELDS created_at;

-- ──────────────────────────────────────────────────────────────
DEFINE TABLE widechat_atendimentos SCHEMAFULL
  PERMISSIONS
    FOR select WHERE $auth.id != NONE,
    FOR create FULL,
    FOR update, delete WHERE $auth.role = 'admin';

DEFINE FIELD lead_id          ON widechat_atendimentos TYPE option<record<leads>>;
DEFINE FIELD protocol         ON widechat_atendimentos TYPE option<string>;
DEFINE FIELD widechat_agent_id ON widechat_atendimentos TYPE option<string>;
DEFINE FIELD session_id       ON widechat_atendimentos TYPE option<string>;
DEFINE FIELD contact_id       ON widechat_atendimentos TYPE option<string>;
DEFINE FIELD aceito_em        ON widechat_atendimentos TYPE datetime;
DEFINE FIELD created_at       ON widechat_atendimentos TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_widechat_atend_protocol ON widechat_atendimentos FIELDS protocol;
DEFINE INDEX idx_widechat_atend_lead     ON widechat_atendimentos FIELDS lead_id;

-- ──────────────────────────────────────────────────────────────
DEFINE TABLE widechat_webhook_logs SCHEMAFULL
  PERMISSIONS
    FOR select WHERE $auth.role = 'admin',
    FOR create FULL,
    FOR update, delete WHERE $auth.role = 'admin';

DEFINE FIELD event_type ON widechat_webhook_logs TYPE option<string>;
DEFINE FIELD payload    ON widechat_webhook_logs TYPE option<object>;
DEFINE FIELD processed  ON widechat_webhook_logs TYPE bool DEFAULT false;
DEFINE FIELD error      ON widechat_webhook_logs TYPE option<string>;
DEFINE FIELD created_at ON widechat_webhook_logs TYPE datetime DEFAULT time::now();

-- ──────────────────────────────────────────────────────────────
-- messages_logs (dados históricos — parou em 22/07/2026)
DEFINE TABLE messages_logs SCHEMAFULL
  PERMISSIONS
    FOR select WHERE $auth.id != NONE,
    FOR create FULL,
    FOR update, delete WHERE $auth.role = 'admin';

DEFINE FIELD contact     ON messages_logs TYPE option<string>;
DEFINE FIELD agent_name  ON messages_logs TYPE option<string>;
DEFINE FIELD timestamp   ON messages_logs TYPE option<datetime>;
DEFINE FIELD content     ON messages_logs TYPE option<string>;
DEFINE FIELD session_id  ON messages_logs TYPE option<string>;
DEFINE FIELD created_at  ON messages_logs TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_messages_logs_agent   ON messages_logs FIELDS agent_name;
DEFINE INDEX idx_messages_logs_ts      ON messages_logs FIELDS timestamp;

-- ============================================================
-- MÓDULO INTEGRATIONS
-- ============================================================

DEFINE TABLE user_integrations SCHEMAFULL
  PERMISSIONS
    FOR select WHERE $auth.role = 'admin',
    FOR create, update, delete WHERE $auth.role = 'admin';

DEFINE FIELD profile_id    ON user_integrations TYPE record<profiles>;
DEFINE FIELD service       ON user_integrations TYPE string; -- 'meta', 'google', 'sponte', etc.
DEFINE FIELD credentials   ON user_integrations TYPE option<object>;
DEFINE FIELD active        ON user_integrations TYPE bool DEFAULT true;
DEFINE FIELD created_at    ON user_integrations TYPE datetime DEFAULT time::now();
DEFINE FIELD updated_at    ON user_integrations TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_user_integrations_profile ON user_integrations FIELDS profile_id;
DEFINE INDEX idx_user_integrations_service ON user_integrations FIELDS service;

-- ──────────────────────────────────────────────────────────────
DEFINE TABLE upload_logs SCHEMAFULL
  PERMISSIONS
    FOR select WHERE $auth.id != NONE,
    FOR create WHERE $auth.id != NONE,
    FOR update, delete WHERE $auth.role = 'admin';

DEFINE FIELD profile_id  ON upload_logs TYPE record<profiles>;
DEFINE FIELD file_name   ON upload_logs TYPE string;
DEFINE FIELD file_type   ON upload_logs TYPE option<string>;
DEFINE FIELD file_size   ON upload_logs TYPE option<int>;
DEFINE FIELD status      ON upload_logs TYPE string DEFAULT 'pending';
DEFINE FIELD error       ON upload_logs TYPE option<string>;
DEFINE FIELD created_at  ON upload_logs TYPE datetime DEFAULT time::now();

-- ──────────────────────────────────────────────────────────────
DEFINE TABLE sendpulse_webhook_logs SCHEMAFULL
  PERMISSIONS
    FOR select WHERE $auth.role = 'admin',
    FOR create FULL,
    FOR update, delete WHERE $auth.role = 'admin';

DEFINE FIELD event_type ON sendpulse_webhook_logs TYPE option<string>;
DEFINE FIELD payload    ON sendpulse_webhook_logs TYPE option<object>;
DEFINE FIELD processed  ON sendpulse_webhook_logs TYPE bool DEFAULT false;
DEFINE FIELD created_at ON sendpulse_webhook_logs TYPE datetime DEFAULT time::now();

-- ============================================================
-- FIM DO SCHEMA
-- ============================================================
