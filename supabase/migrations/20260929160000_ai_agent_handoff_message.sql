-- Aviso de transferência GARANTIDO ao passar pra humano (29/09, pedido do usuário: "não dá
-- pra só mover o card e deixar o cliente sem saber o que aconteceu"). Achado ao vivo: a IA
-- decidia handoff=true (ex.: "lead quer se matricular") mas às vezes escrevia só uma pergunta
-- ("posso te passar como funciona a matrícula?"), nunca avisando de verdade que um consultor
-- ia assumir — aí a trava de handoff entrava e a próxima mensagem do lead ficava sem resposta
-- nenhuma. Agora, sempre que handoff=true, este texto entra (preenchido) DEPOIS da resposta
-- da IA — não depende só do modelo lembrar de avisar.
ALTER TABLE ai_agent_settings
  ADD COLUMN IF NOT EXISTS horario_atendimento text NOT NULL DEFAULT
    'de segunda a sexta-feira, das 8h às 20h (exceto feriados)',
  ADD COLUMN IF NOT EXISTS handoff_message text NOT NULL DEFAULT
    E'Um dos nossos consultores vai continuar seu atendimento a partir daqui{nome_virgula}! 💙\n\n⏰ Nosso atendimento humano funciona {horario}. Se você escreveu fora desse horário, a resposta chega assim que reabrirmos.';
