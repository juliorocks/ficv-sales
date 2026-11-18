-- Aluno não abre 2º chamado na mesma categoria enquanto houver um aberto (2026-11-18): o botão "abrir mesmo assim" gerava duplicidade.
-- 'outros' fica de fora (não é um assunto único). Só vale quando o próprio aluno cria; equipe e transferências não são barradas.
CREATE OR REPLACE FUNCTION public.trg_limite_tickets_abertos() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.aluno_id IS NOT NULL AND auth.uid() IS NOT NULL AND auth.uid() = NEW.aluno_id THEN
    IF NEW.categoria IS DISTINCT FROM 'outros' AND EXISTS (
         SELECT 1 FROM public.tickets t
          WHERE t.aluno_id = NEW.aluno_id AND t.categoria = NEW.categoria
            AND t.status NOT IN ('resolvido', 'fechado')) THEN
      RAISE EXCEPTION 'ASSUNTO_JA_ABERTO: você já tem um chamado aberto nesse assunto. Continue por ele.'
        USING ERRCODE = 'P0001';
    END IF;
    IF (SELECT count(*) FROM public.tickets t
         WHERE t.aluno_id = NEW.aluno_id AND t.status NOT IN ('resolvido', 'fechado')) >= 2 THEN
      RAISE EXCEPTION 'LIMITE_TICKETS_ABERTOS: você já tem 2 chamados em aberto. Continue por um deles ou aguarde a resolução.'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $$;
