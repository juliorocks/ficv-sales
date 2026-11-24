-- Espelho do Sponte da ESCOLA (conta 489164), separado do da Faculdade (489166).
-- Mesma estrutura de sponte_matriculas / sponte_parcelas, sem os gatilhos da Faculdade
-- (ajuste de RA, parcela de contrato cancelado, baixa externa da Super Live): regras da Faculdade não valem aqui.
CREATE TABLE IF NOT EXISTS public.escola_sponte_matriculas (LIKE public.sponte_matriculas INCLUDING ALL);
CREATE TABLE IF NOT EXISTS public.escola_sponte_parcelas   (LIKE public.sponte_parcelas   INCLUDING ALL);

ALTER TABLE public.escola_sponte_matriculas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.escola_sponte_parcelas   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS escola_sponte_matriculas_staff ON public.escola_sponte_matriculas;
CREATE POLICY escola_sponte_matriculas_staff ON public.escola_sponte_matriculas FOR SELECT TO authenticated USING (public.is_staff());
DROP POLICY IF EXISTS escola_sponte_parcelas_staff ON public.escola_sponte_parcelas;
CREATE POLICY escola_sponte_parcelas_staff ON public.escola_sponte_parcelas FOR SELECT TO authenticated USING (public.is_staff());
