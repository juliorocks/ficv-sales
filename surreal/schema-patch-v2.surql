-- ============================================================
-- SCHEMA PATCH v2 — alinhar campos com o Supabase real
-- ============================================================

-- ── agent_profiles ──────────────────────────────────────────
-- Supabase tem: name, photo_url, score_target, role, email, phone, notes, active, team_id (UUID), created_at, updated_at
-- SurrealDB tinha: profile_id (record), score_target, phone, notes, team_id (record), active
REMOVE FIELD profile_id ON agent_profiles;
REMOVE INDEX idx_agent_profiles_profile ON agent_profiles;

DEFINE FIELD name       ON agent_profiles TYPE string;
DEFINE FIELD photo_url  ON agent_profiles TYPE option<string>;
DEFINE FIELD score_target ON agent_profiles TYPE decimal DEFAULT 8.0;
DEFINE FIELD role       ON agent_profiles TYPE option<string>;
DEFINE FIELD email      ON agent_profiles TYPE option<string>;
DEFINE FIELD phone      ON agent_profiles TYPE option<string>;
DEFINE FIELD notes      ON agent_profiles TYPE option<string>;
DEFINE FIELD active     ON agent_profiles TYPE bool DEFAULT true;
DEFINE FIELD team_id    ON agent_profiles TYPE option<string>;
DEFINE FIELD created_at ON agent_profiles TYPE datetime DEFAULT time::now();
DEFINE FIELD updated_at ON agent_profiles TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_agent_profiles_name ON agent_profiles FIELDS name UNIQUE;

-- ── agent_reports ────────────────────────────────────────────
-- Supabase tem: agent_name, year, month, share_token, status, generated_at, created_by
-- SurrealDB tinha: profile_id, period_start, period_end, metrics, created_at
REMOVE FIELD profile_id  ON agent_reports;
REMOVE FIELD period_start ON agent_reports;
REMOVE FIELD period_end  ON agent_reports;
REMOVE FIELD metrics     ON agent_reports;

DEFINE FIELD agent_name   ON agent_reports TYPE string;
DEFINE FIELD year         ON agent_reports TYPE int;
DEFINE FIELD month        ON agent_reports TYPE int;
DEFINE FIELD share_token  ON agent_reports TYPE option<string>;
DEFINE FIELD status       ON agent_reports TYPE option<string>;
DEFINE FIELD generated_at ON agent_reports TYPE option<datetime>;
DEFINE FIELD created_by   ON agent_reports TYPE option<string>;
DEFINE FIELD created_at   ON agent_reports TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_agent_reports_uniq ON agent_reports FIELDS agent_name, year, month UNIQUE;

-- ── upload_logs ──────────────────────────────────────────────
-- Supabase tem: filename, uploaded_by (UUID), record_count, created_at
-- SurrealDB tinha: profile_id, file_name, file_type, file_size, status, error, created_at
REMOVE FIELD profile_id  ON upload_logs;
REMOVE FIELD file_name   ON upload_logs;
REMOVE FIELD file_type   ON upload_logs;
REMOVE FIELD file_size   ON upload_logs;
REMOVE FIELD status      ON upload_logs;
REMOVE FIELD error       ON upload_logs;

DEFINE FIELD filename     ON upload_logs TYPE option<string>;
DEFINE FIELD uploaded_by  ON upload_logs TYPE option<string>;
DEFINE FIELD record_count ON upload_logs TYPE option<int>;
DEFINE FIELD created_at   ON upload_logs TYPE datetime DEFAULT time::now();

-- ── user_integrations ────────────────────────────────────────
-- Supabase tem: user_id (UUID), widechat_email, widechat_password, widechat_session_token, widechat_token_expires_at
-- SurrealDB tinha: profile_id (record), service, credentials, active
REMOVE FIELD profile_id  ON user_integrations;
REMOVE FIELD service     ON user_integrations;
REMOVE FIELD credentials ON user_integrations;
REMOVE FIELD active      ON user_integrations;
REMOVE INDEX idx_user_integrations_profile ON user_integrations;
REMOVE INDEX idx_user_integrations_service ON user_integrations;

DEFINE FIELD user_id                   ON user_integrations TYPE option<string>;
DEFINE FIELD widechat_email            ON user_integrations TYPE option<string>;
DEFINE FIELD widechat_password         ON user_integrations TYPE option<string>;
DEFINE FIELD widechat_session_token    ON user_integrations TYPE option<string>;
DEFINE FIELD widechat_token_expires_at ON user_integrations TYPE option<datetime>;
DEFINE FIELD created_at ON user_integrations TYPE datetime DEFAULT time::now();
DEFINE FIELD updated_at ON user_integrations TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_user_integrations_user ON user_integrations FIELDS user_id;

-- ── meta_account_stats ───────────────────────────────────────
-- Supabase tem: id=1, balance, currency, google_balance, updated_at
-- SurrealDB tinha: date, spend, metrics, synced_at
REMOVE FIELD date      ON meta_account_stats;
REMOVE FIELD spend     ON meta_account_stats;
REMOVE FIELD metrics   ON meta_account_stats;
REMOVE FIELD synced_at ON meta_account_stats;

DEFINE FIELD balance        ON meta_account_stats TYPE option<decimal>;
DEFINE FIELD currency       ON meta_account_stats TYPE option<string>;
DEFINE FIELD google_balance ON meta_account_stats TYPE option<decimal>;
DEFINE FIELD updated_at     ON meta_account_stats TYPE datetime DEFAULT time::now();

-- ── widechat_raw_messages ────────────────────────────────────
-- Supabase tem: session_id, origin, sender_name, message, platform_id, message_id, created_at, received_at
-- SurrealDB tinha: payload (object), created_at → manter payload, adicionar campos diretos
DEFINE FIELD session_id  ON widechat_raw_messages TYPE option<string>;
DEFINE FIELD origin      ON widechat_raw_messages TYPE option<string>;
DEFINE FIELD sender_name ON widechat_raw_messages TYPE option<string>;
DEFINE FIELD message     ON widechat_raw_messages TYPE option<string>;
DEFINE FIELD platform_id ON widechat_raw_messages TYPE option<string>;
DEFINE FIELD message_id  ON widechat_raw_messages TYPE option<string>;
DEFINE FIELD received_at ON widechat_raw_messages TYPE option<datetime>;

DEFINE INDEX idx_widechat_raw_origin ON widechat_raw_messages FIELDS origin;

-- ── audit_logs ───────────────────────────────────────────────
-- user_id no Supabase é UUID do auth (string), não record<profiles>
REMOVE FIELD user_id ON audit_logs;
DEFINE FIELD user_id ON audit_logs TYPE option<string>;
DEFINE FIELD action  ON audit_logs TYPE option<string>;
