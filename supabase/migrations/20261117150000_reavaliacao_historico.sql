-- 17/11: o histórico do CSV (jan–set/2026) foi reavaliado com a mesma heurística e as mesmas regras de
-- conversão (matrícula atribuída por telefone, link de pagamento) para ficar comparável com a nota nova.
-- nota_original guarda a nota que a linha tinha antes. Reverter:
--   UPDATE messages_logs SET final_score = nota_original WHERE reavaliada_em IS NOT NULL AND nota_original IS NOT NULL;
ALTER TABLE messages_logs ADD COLUMN IF NOT EXISTS nota_original double precision;
ALTER TABLE messages_logs ADD COLUMN IF NOT EXISTS reavaliada_em timestamptz;
