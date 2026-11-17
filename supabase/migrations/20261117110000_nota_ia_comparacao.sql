-- 17/11: a heurística calibrada vira o método oficial da nota de atendimento; a IA só roda sob demanda
-- (modo "compare" do evaluate-conversations) e guarda o resultado aqui, sem mexer em final_score.
ALTER TABLE messages_logs ADD COLUMN IF NOT EXISTS nota_ia double precision;

-- Preserva a nota que a IA já tinha dado (antes da reavaliação pela heurística nova).
UPDATE messages_logs SET nota_ia = final_score
 WHERE avaliacao_metodo = 'ia' AND status = 'approved' AND final_score > 0 AND nota_ia IS NULL;
