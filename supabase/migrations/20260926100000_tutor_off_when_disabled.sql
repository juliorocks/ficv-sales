-- Tutor Virtual desligado → chamado nasce com ai_status='off' (fila humana). Antes nascia
-- 'active' e o portal mostrava "Tutor Virtual está respondendo…" pra sempre (26/09).
CREATE OR REPLACE FUNCTION public.ticket_tutor_default() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.origem = 'transferencia' OR NOT coalesce((SELECT enabled FROM tutor_settings WHERE id = 1), false) THEN
    NEW.ai_status := 'off';
  END IF;
  RETURN NEW;
END $$;
