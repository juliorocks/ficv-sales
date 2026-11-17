-- 17/11: de onde veio o "convertido" da nota: 'matricula' (cruzamento Sponte ou etapa Matriculado) ou 'link'
-- (agente enviou link de pagamento/inscrição em conversa comercial).
ALTER TABLE messages_logs ADD COLUMN IF NOT EXISTS convertido_via text;
