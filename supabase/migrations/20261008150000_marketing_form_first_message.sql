-- 08/10: 1ª mensagem da Vivi mencionando "já visitou nosso site do curso" só faz sentido
-- pra quem veio de um Formulário de Marketing — pra quem manda WhatsApp direto (sem LP),
-- a mesma frase seria falsa. `from_marketing_form` marca a origem no lead; o gatilho escolhe
-- o template certo com base nela, sem mexer em nada do fluxo de WhatsApp-direto.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS from_marketing_form boolean NOT NULL DEFAULT false;

ALTER TABLE vivaconnect_settings ADD COLUMN IF NOT EXISTS first_message_template_form text;
UPDATE vivaconnect_settings SET first_message_template_form =
$tpl$Oi, {primeiro_nome}! Aqui é a 🤖 Vivi, a Agente Virtual da FICV 😊

Recebemos seu interesse{curso_trecho}.

Estou aqui para tirar as suas dúvidas e se quiser falar com um dos nossos Consultores, pode falar a qualquer momento, certo?

Agora, vi que já visitou o nosso site do curso. Ficou alguma dúvida ou já quer iniciar a sua Matrícula?$tpl$
WHERE id = 1 AND first_message_template_form IS NULL;

CREATE OR REPLACE FUNCTION public.vivaconnect_enqueue_first_message()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  s      vivaconnect_settings;
  digits text := regexp_replace(coalesce(NEW.telefone,''), '\D', '', 'g');
  first  text := initcap(split_part(trim(coalesce(NEW.nome_completo,'')), ' ', 1));
  curso  text;
  tpl    text;
  msg    text;
BEGIN
  IF NEW.preferred_contact IS DISTINCT FROM 'whatsapp' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.preferred_contact IS NOT DISTINCT FROM 'whatsapp' THEN RETURN NEW; END IF;
  SELECT * INTO s FROM vivaconnect_settings WHERE id = 1;
  IF NOT (s.enabled AND s.first_message_enabled) THEN RETURN NEW; END IF;
  IF length(digits) < 10 OR digits ~ '^0+$' THEN RETURN NEW; END IF;
  IF length(digits) IN (10, 11) THEN digits := '55' || digits; END IF;

  SELECT name INTO curso FROM courses WHERE id = NEW.curso_interesse;
  tpl := CASE WHEN NEW.from_marketing_form AND s.first_message_template_form IS NOT NULL
              THEN s.first_message_template_form ELSE s.first_message_template END;
  msg := replace(replace(replace(tpl,
           '{primeiro_nome}', coalesce(nullif(first,''), 'tudo bem')),
           '{curso_trecho}',  CASE WHEN curso IS NOT NULL THEN ' no curso de ' || curso ELSE '' END),
           '{curso}',         coalesce(curso, ''));

  INSERT INTO vivaconnect_outbox (lead_id, channel_id, kind, number, body)
  VALUES (NEW.id, NEW.vivaconnect_channel_id, 'first_message', digits, msg)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $function$;
