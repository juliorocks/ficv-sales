-- ============================================================
-- Integração Meta Ads (Marketing API)
-- Campanhas, insights diários e demografia da conta de anúncios,
-- sincronizados via Edge Function sync-meta-ads
-- ============================================================

CREATE TABLE IF NOT EXISTS meta_campaigns (
  campaign_id TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  objective   TEXT,
  status      TEXT,
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- Sem FK para meta_campaigns: evita depender da ordem de sync ou de
-- campanhas apagadas na Meta (mesmo motivo do sponte_matriculas).
CREATE TABLE IF NOT EXISTS meta_campaign_insights_daily (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id   TEXT NOT NULL,
  campaign_name TEXT,
  date          DATE NOT NULL,
  spend         NUMERIC DEFAULT 0,
  impressions   BIGINT DEFAULT 0,
  clicks        BIGINT DEFAULT 0,
  reach         BIGINT DEFAULT 0,
  frequency     NUMERIC DEFAULT 0,
  ctr           NUMERIC DEFAULT 0,
  cpm           NUMERIC DEFAULT 0,
  leads_count   INTEGER DEFAULT 0,
  actions_raw   JSONB,
  synced_at     TIMESTAMPTZ DEFAULT now(),
  UNIQUE(campaign_id, date)
);

CREATE INDEX IF NOT EXISTS idx_meta_insights_date ON meta_campaign_insights_daily(date);

CREATE TABLE IF NOT EXISTS meta_demographics_daily (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  date        DATE NOT NULL,
  age_range   TEXT,
  gender      TEXT,
  spend       NUMERIC DEFAULT 0,
  impressions BIGINT DEFAULT 0,
  clicks      BIGINT DEFAULT 0,
  leads_count INTEGER DEFAULT 0,
  synced_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE(date, age_range, gender)
);

CREATE INDEX IF NOT EXISTS idx_meta_demographics_date ON meta_demographics_daily(date);

-- RLS — mesmo padrão de supabase/migrations/20260701_matriculas.sql
ALTER TABLE meta_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_campaign_insights_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_demographics_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_read" ON meta_campaigns
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "admin_write" ON meta_campaigns
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

CREATE POLICY "authenticated_read" ON meta_campaign_insights_daily
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "admin_write" ON meta_campaign_insights_daily
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

CREATE POLICY "authenticated_read" ON meta_demographics_daily
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "admin_write" ON meta_demographics_daily
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );
