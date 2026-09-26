-- Mensagem de passagem pra equipe do Tutor Virtual: texto PADRÃO (não improvisado pela IA)
-- com horário de atendimento, aviso por e-mail e resposta pelo e-mail (quando ativa).
-- Variáveis: {primeiro_nome} {fila} {horario} {email} {protocolo} {resposta_email}
ALTER TABLE tutor_settings
  ADD COLUMN IF NOT EXISTS horario_atendimento text NOT NULL DEFAULT 'de segunda a sexta-feira, das 8h às 20h (exceto feriados)',
  ADD COLUMN IF NOT EXISTS handoff_message text NOT NULL DEFAULT
'{primeiro_nome}, encaminhei sua solicitação para a equipe {fila}. 🙌

⏰ Nosso atendimento funciona {horario}. Se você escreveu fora desse horário, a resposta chega no próximo período de atendimento.

📧 Assim que a equipe responder, você recebe um aviso no e-mail {email}{resposta_email}. Você também acompanha tudo por aqui, no Portal do Aluno — protocolo {protocolo}.';
