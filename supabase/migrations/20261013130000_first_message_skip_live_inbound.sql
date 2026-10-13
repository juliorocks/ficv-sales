-- Achado ao vivo 13/10 (lead "Annelize Tomé"): ela escreveu direto pelo WhatsApp (passou
-- pelo Hub, perguntou sobre mensalidade atrasada), a IA respondeu de verdade indicando o
-- Portal do Aluno — e, 2 minutos depois, essa mesma função disparou a saudação genérica de
-- "1ª mensagem" ("Oi, Annelize! Aqui é a Vivi...") por cima de uma conversa que já estava
-- rolando, como se ela nunca tivesse escrito. Causa: o gatilho dispara em QUALQUER INSERT de
-- lead com preferred_contact='whatsapp' — e o vivaconnect-webhook grava esse valor em TODO
-- lead criado a partir de uma mensagem de WhatsApp real (Hub/comercial), não só nos de
-- formulário/importação (único caso em que faz sentido A GENTE puxar o papo primeiro).
-- fonte_lead distingue os dois: "VivaConnect — ..." e "Widechat" são sempre conversa que já
-- está acontecendo (mesmo critério já usado em WideChatHistory.tsx pra "veioDeFormulario").
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
  IF NEW.fonte_lead ILIKE 'VivaConnect%' OR NEW.fonte_lead ILIKE 'Widechat%' THEN RETURN NEW; END IF;
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
