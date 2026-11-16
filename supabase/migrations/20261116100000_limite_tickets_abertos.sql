-- Aluno com 2 chamados em aberto não abre um terceiro (2026-11-16): evita chamado repetido e a equipe se perder.
-- Vale só quando o próprio aluno cria (auth.uid() = aluno_id). Equipe (staff-tickets, service role) e transferências não são barradas.
CREATE OR REPLACE FUNCTION public.trg_limite_tickets_abertos() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.aluno_id IS NOT NULL AND auth.uid() IS NOT NULL AND auth.uid() = NEW.aluno_id
     AND (SELECT count(*) FROM public.tickets t
           WHERE t.aluno_id = NEW.aluno_id AND t.status NOT IN ('resolvido', 'fechado')) >= 2 THEN
    RAISE EXCEPTION 'LIMITE_TICKETS_ABERTOS: você já tem 2 chamados em aberto. Continue por um deles ou aguarde a resolução.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS limite_tickets_abertos ON public.tickets;
CREATE TRIGGER limite_tickets_abertos BEFORE INSERT ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.trg_limite_tickets_abertos();

CREATE INDEX IF NOT EXISTS idx_tickets_aluno_status ON public.tickets (aluno_id, status);
