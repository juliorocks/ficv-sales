-- ============================================================================
-- Chaves naturais para os UPSERT dos syncs (Sponte/Meta/Google).
-- ============================================================================

-- sponte_matriculas: upsert por contrato_id
DELETE FROM sponte_matriculas a USING sponte_matriculas b
  WHERE a.ctid < b.ctid AND a.contrato_id IS NOT DISTINCT FROM b.contrato_id;
ALTER TABLE sponte_matriculas
  ADD CONSTRAINT sponte_matriculas_contrato_id_key UNIQUE (contrato_id);

-- sponte_parcelas: upsert por (conta_receber_id, numero_parcela)
DELETE FROM sponte_parcelas a USING sponte_parcelas b
  WHERE a.ctid < b.ctid
    AND a.conta_receber_id IS NOT DISTINCT FROM b.conta_receber_id
    AND a.numero_parcela   IS NOT DISTINCT FROM b.numero_parcela;
ALTER TABLE sponte_parcelas
  ADD CONSTRAINT sponte_parcelas_conta_parcela_key
  UNIQUE NULLS NOT DISTINCT (conta_receber_id, numero_parcela);

-- meta/google já têm índices UNIQUE:
--   meta_campaign_insights_daily (campaign_id, date)  -> idx_meta_insights_date
--   meta_demographics_daily (date, age_range, gender)  -> idx_meta_demo_uniq
--   google_ads_insights_daily (campaign_id, date)      -> idx_gads_camp_date
--   meta_campaigns / google_ads_campaigns: PK campaign_id
--   financial_goals (year, month)                      -> idx_financial_goals_month

-- normaliza NULLs de dedupe pra o UNIQUE de demographics funcionar
UPDATE meta_demographics_daily SET age_range = COALESCE(age_range,'?'), gender = COALESCE(gender,'?')
  WHERE age_range IS NULL OR gender IS NULL;
