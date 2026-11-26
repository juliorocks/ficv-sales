-- Espelho local da Pagar.me (Stone), que recebe só as matrículas. Uma linha por recebível/repasse/transferência.
-- A API só guarda 24 meses de histórico pago e não avisa payable/settlement por webhook: o espelho é preenchido por consulta periódica.
-- empresa_id separa Faculdade e Escola (cada uma tem o seu recebedor). Escrita só pela service role; leitura só admin.
CREATE TABLE IF NOT EXISTS public.pagarme_recebedores (
  recipient_id text PRIMARY KEY,
  empresa text NOT NULL CHECK (empresa IN ('faculdade','escola')),
  nome text,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pagarme_payables (
  id text PRIMARY KEY,
  empresa text NOT NULL CHECK (empresa IN ('faculdade','escola')),
  recipient_id text NOT NULL,
  status text,
  tipo text,
  metodo_pagamento text,
  valor_bruto numeric(14,2),
  taxa numeric(14,2),
  antecipacao numeric(14,2),
  valor_liquido numeric(14,2),
  parcela int,
  total_parcelas int,
  data_pagamento date,
  data_prevista date,
  data_criacao timestamptz,
  transaction_id text,
  charge_id text,
  order_id text,
  split_id text,
  settlement_id text,
  bruto jsonb,
  sincronizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pagarme_payables_pgto ON public.pagarme_payables (empresa, data_pagamento);
CREATE INDEX IF NOT EXISTS pagarme_payables_charge ON public.pagarme_payables (charge_id);

CREATE TABLE IF NOT EXISTS public.pagarme_settlements (
  id text PRIMARY KEY,
  empresa text NOT NULL CHECK (empresa IN ('faculdade','escola')),
  recipient_id text NOT NULL,
  status text,
  valor numeric(14,2),
  data_pagamento date,
  data_criacao timestamptz,
  bruto jsonb,
  sincronizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pagarme_settlements_pgto ON public.pagarme_settlements (empresa, data_pagamento);

CREATE TABLE IF NOT EXISTS public.pagarme_transfers (
  id text PRIMARY KEY,
  empresa text NOT NULL CHECK (empresa IN ('faculdade','escola')),
  recipient_id text NOT NULL,
  status text,
  valor numeric(14,2),
  taxa numeric(14,2),
  data_criacao timestamptz,
  data_prevista date,
  bruto jsonb,
  sincronizado_em timestamptz NOT NULL DEFAULT now()
);

-- Ponteiro do polling por recebedor e tabela (a API só pagina para frente)
CREATE TABLE IF NOT EXISTS public.pagarme_cursor (
  recipient_id text NOT NULL,
  recurso text NOT NULL,
  ultima_data date,
  cursor text,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (recipient_id, recurso)
);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['pagarme_recebedores','pagarme_payables','pagarme_settlements','pagarme_transfers','pagarme_cursor'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_admin_leitura', t);
    IF t <> 'pagarme_cursor' THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_admin())', t||'_admin_leitura', t);
    END IF;
  END LOOP;
END $$;
