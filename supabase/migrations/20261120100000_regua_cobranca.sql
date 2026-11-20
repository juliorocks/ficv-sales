-- Régua de cobrança (2026-11-20): avisos de mensalidade a vencer/vencida por e-mail (e WhatsApp numa próxima etapa).
-- O Portal calcula o aviso ao vivo, sem tabela. Começa em modo 'teste' (não envia para aluno).
CREATE TABLE IF NOT EXISTS public.regua_cobranca_config (
  id               integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  modo             text NOT NULL DEFAULT 'teste' CHECK (modo IN ('teste','ligado')),
  email_ativo      boolean NOT NULL DEFAULT true,
  whatsapp_ativo   boolean NOT NULL DEFAULT false,
  limite_email_dia integer NOT NULL DEFAULT 60,
  updated_at       timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.regua_cobranca_config (id) VALUES (1) ON CONFLICT DO NOTHING;

-- dias = dias em relação ao vencimento (negativo = antes, 0 = no dia, positivo = atraso)
CREATE TABLE IF NOT EXISTS public.regua_cobranca_etapas (
  id      serial PRIMARY KEY,
  dias    integer NOT NULL UNIQUE,
  nome    text NOT NULL,
  assunto text NOT NULL,
  texto   text NOT NULL,
  ativo   boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS public.regua_cobranca_envios (
  id               bigserial PRIMARY KEY,
  aluno_id         integer NOT NULL,
  conta_receber_id bigint,
  numero_parcela   text,
  etapa_id         integer NOT NULL REFERENCES public.regua_cobranca_etapas(id),
  canal            text NOT NULL CHECK (canal IN ('email','whatsapp','sms')),
  status           text NOT NULL CHECK (status IN ('enviado','falhou')),
  destino          text,
  erro             text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (conta_receber_id, numero_parcela, etapa_id, canal)
);
CREATE INDEX IF NOT EXISTS idx_regua_envios_aluno ON public.regua_cobranca_envios (aluno_id, created_at DESC);

ALTER TABLE public.regua_cobranca_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.regua_cobranca_etapas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.regua_cobranca_envios ENABLE ROW LEVEL SECURITY;
CREATE POLICY regua_config_sel ON public.regua_cobranca_config FOR SELECT USING (public.is_staff());
CREATE POLICY regua_config_adm ON public.regua_cobranca_config FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY regua_etapas_sel ON public.regua_cobranca_etapas FOR SELECT USING (public.is_staff());
CREATE POLICY regua_etapas_adm ON public.regua_cobranca_etapas FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY regua_envios_sel ON public.regua_cobranca_envios FOR SELECT USING (public.is_staff());

-- Textos sem valores (o valor depende de desconto/bolsa; a tela do Portal mostra o certo). Variáveis: {nome} {dias} {vencimento}
INSERT INTO public.regua_cobranca_etapas (dias, nome, assunto, texto) VALUES
 (-5, 'Lembrete (5 dias antes)', 'Sua mensalidade vence em breve',
  'Olá, {nome}! Passando para lembrar que a sua mensalidade vence em {dias} dias, no dia {vencimento}. Você pode ver o boleto e pagar pelo Portal do Aluno.'),
 (-2, 'Aviso (2 dias antes)', 'Sua mensalidade vence em {dias} dias',
  'Olá, {nome}! A sua mensalidade vence em {dias} dias, no dia {vencimento}. Para evitar juros e multa, confira o boleto no Portal do Aluno.'),
 (0, 'Vence hoje', 'Sua mensalidade vence hoje',
  'Olá, {nome}! A sua mensalidade vence hoje ({vencimento}). Pague pelo Portal do Aluno para manter tudo em dia.'),
 (1, 'Venceu ontem', 'Sua mensalidade venceu',
  'Olá, {nome}. Identificamos que a sua mensalidade de {vencimento} ainda não foi paga. Se já pagou, desconsidere; se não, regularize pelo Portal do Aluno.'),
 (5, 'Atraso de 5 dias', 'Mensalidade em atraso',
  'Olá, {nome}. A sua mensalidade de {vencimento} está em atraso há {dias} dias. Regularize pelo Portal do Aluno ou abra um chamado de Financeiro para falar com a equipe.'),
 (10, 'Atraso de 10 dias', 'Mensalidade em atraso há 10 dias',
  'Olá, {nome}. A sua mensalidade de {vencimento} segue em aberto há {dias} dias, com juros e multa. Regularize pelo Portal do Aluno ou abra um chamado de Financeiro para negociar.'),
 (20, 'Atraso de 20 dias', 'Importante: mensalidade em atraso',
  'Olá, {nome}. A sua mensalidade de {vencimento} está em atraso há {dias} dias. Para evitar restrições no seu acesso e na sua matrícula, regularize ou procure o Financeiro pelo Portal do Aluno.')
ON CONFLICT (dias) DO NOTHING;

-- Parcelas que entram hoje em cada etapa. Janela de 1 dia de tolerância (se o cron falhar um dia, recupera);
-- só a etapa mais avançada por parcela; só aluno com matrícula Vigente; ignora o que já foi enviado nesse canal.
CREATE OR REPLACE FUNCTION public.regua_cobranca_candidatos(p_hoje date, p_canal text)
RETURNS TABLE(aluno_id integer, nome text, email text, conta_receber_id bigint, numero_parcela text,
              vencimento date, etapa_id integer, dias integer, atraso integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT ON (p.conta_receber_id, p.numero_parcela)
         p.aluno_id, COALESCE(a.nome, p.sacado), 
         COALESCE(NULLIF(CASE WHEN a.email LIKE '%@aluno.ficv.br' THEN NULL ELSE a.email END, ''), NULLIF(c.email, '')),
         p.conta_receber_id, p.numero_parcela, p.vencimento, e.id, e.dias, (p_hoje - p.vencimento)
    FROM sponte_parcelas p
    JOIN regua_cobranca_etapas e ON e.ativo AND p.vencimento BETWEEN p_hoje - e.dias - 1 AND p_hoje - e.dias
    LEFT JOIN alunos a ON a.sponte_aluno_id = p.aluno_id
    LEFT JOIN sponte_alunos_contato c ON c.aluno_id = p.aluno_id
   WHERE p.situacao_parcela = 'Pendente'
     AND EXISTS (SELECT 1 FROM sponte_matriculas m WHERE m.aluno_id = p.aluno_id AND m.situacao_id = 1)
     AND NOT EXISTS (SELECT 1 FROM regua_cobranca_envios v JOIN regua_cobranca_etapas e2 ON e2.id = v.etapa_id
                      WHERE v.conta_receber_id IS NOT DISTINCT FROM p.conta_receber_id
                        AND v.numero_parcela IS NOT DISTINCT FROM p.numero_parcela
                        AND v.canal = p_canal AND v.status = 'enviado' AND e2.dias >= e.dias)
   ORDER BY p.conta_receber_id, p.numero_parcela, e.dias DESC;
$$;
REVOKE ALL ON FUNCTION public.regua_cobranca_candidatos(date, text) FROM PUBLIC, anon, authenticated;
