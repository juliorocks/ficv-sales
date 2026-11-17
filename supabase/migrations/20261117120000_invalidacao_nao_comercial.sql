-- 17/11: atendimento sem assunto comercial (transferência para Secretaria/Tutor/Financeiro, suporte a aluno,
-- aviso administrativo, conversa sem fala de agente) não entra na nota do Comercial. Guarda o estado anterior
-- para poder reverter: UPDATE messages_logs SET status = status_anterior, status_anterior = NULL, invalidado_motivo = NULL WHERE invalidado_motivo IS NOT NULL;
ALTER TABLE messages_logs ADD COLUMN IF NOT EXISTS status_anterior text;
ALTER TABLE messages_logs ADD COLUMN IF NOT EXISTS invalidado_motivo text;
