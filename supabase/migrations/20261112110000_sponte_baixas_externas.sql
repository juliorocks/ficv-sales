-- Baixas feitas por sistema externo (2026-11-12): a Super Live dá baixa na matrícula paga pela Guru com
-- QuitarParcelas (o Sponte confirma: "83 - já encontra-se quitada"), mas GetParcelas segue devolvendo Pendente.
-- A Super Live avisa cada baixa pela função `sponte-baixa`; aqui a parcela vira Quitada no espelho
-- (Portal, Inadimplência, metas). Só service role escreve.
SET statement_timeout = '120s';

CREATE TABLE IF NOT EXISTS public.sponte_baixas_externas (
  conta_receber_id bigint NOT NULL,
  numero_parcela   text   NOT NULL DEFAULT '1',
  valor            numeric,
  pago_em          date,
  pedido_codigo    text,
  origem           text   NOT NULL DEFAULT 'superlive',
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conta_receber_id, numero_parcela)
);
ALTER TABLE public.sponte_baixas_externas ENABLE ROW LEVEL SECURITY;

-- Parcela que chega Pendente do Sponte mas tem baixa externa registrada vira Quitada.
-- Roda antes de `parcela_contrato_cancelado` (ordem alfabética): pago vence cancelado.
CREATE OR REPLACE FUNCTION public.trg_parcela_baixa_externa() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE b public.sponte_baixas_externas;
BEGIN
  IF NEW.situacao_parcela = 'Pendente' THEN
    SELECT * INTO b FROM public.sponte_baixas_externas
     WHERE conta_receber_id = NEW.conta_receber_id AND numero_parcela = NEW.numero_parcela;
    IF FOUND THEN
      NEW.situacao_parcela := 'Quitada';
      NEW.valor_pago := coalesce(nullif(NEW.valor_pago, 0), b.valor, NEW.valor_parcela);
      NEW.data_pagamento := coalesce(NEW.data_pagamento, b.pago_em);
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS parcela_baixa_externa ON public.sponte_parcelas;
CREATE TRIGGER parcela_baixa_externa BEFORE INSERT OR UPDATE OF situacao_parcela, conta_receber_id, numero_parcela
  ON public.sponte_parcelas FOR EACH ROW EXECUTE FUNCTION public.trg_parcela_baixa_externa();

-- Baixa nova: atualiza na hora a parcela que já está no espelho.
CREATE OR REPLACE FUNCTION public.trg_baixa_externa_aplica() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.sponte_parcelas
     SET situacao_parcela = 'Quitada',
         valor_pago = coalesce(nullif(valor_pago, 0), NEW.valor, valor_parcela),
         data_pagamento = coalesce(data_pagamento, NEW.pago_em)
   WHERE conta_receber_id = NEW.conta_receber_id AND numero_parcela = NEW.numero_parcela
     AND situacao_parcela IN ('Pendente', 'Cancelada');
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS baixa_externa_aplica ON public.sponte_baixas_externas;
CREATE TRIGGER baixa_externa_aplica AFTER INSERT OR UPDATE ON public.sponte_baixas_externas
  FOR EACH ROW EXECUTE FUNCTION public.trg_baixa_externa_aplica();
