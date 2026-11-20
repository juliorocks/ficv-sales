-- Régua de cobrança por WhatsApp (2026-11-20): template UTILITY que só manda abrir o Portal. Sem template aprovado, não envia.
ALTER TABLE public.vivaconnect_outbox DROP CONSTRAINT IF EXISTS vivaconnect_outbox_kind_check;
ALTER TABLE public.vivaconnect_outbox ADD CONSTRAINT vivaconnect_outbox_kind_check CHECK (kind = ANY (ARRAY[
  'first_message','student_reply','ai_reply','manual','hub_ask','hub_redirect','hub_forward','farewell','ticket_notice','cobranca']));
ALTER TABLE public.regua_cobranca_etapas ADD COLUMN IF NOT EXISTS whatsapp_template text;
ALTER TABLE public.regua_cobranca_config ADD COLUMN IF NOT EXISTS limite_whatsapp_dia integer NOT NULL DEFAULT 150;

DROP FUNCTION IF EXISTS public.regua_cobranca_candidatos(date, text);
CREATE FUNCTION public.regua_cobranca_candidatos(p_hoje date, p_canal text)
RETURNS TABLE(aluno_id integer, nome text, email text, celular text, conta_receber_id bigint, numero_parcela text,
              vencimento date, etapa_id integer, dias integer, atraso integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT ON (p.conta_receber_id, p.numero_parcela)
         p.aluno_id, COALESCE(a.nome, p.sacado),
         COALESCE(NULLIF(CASE WHEN a.email LIKE '%@aluno.ficv.br' THEN NULL ELSE a.email END, ''), NULLIF(c.email, '')),
         COALESCE(NULLIF(c.celular, ''), NULLIF(a.telefone, ''), NULLIF(c.telefone, '')),
         p.conta_receber_id, p.numero_parcela, p.vencimento, e.id, e.dias, (p_hoje - p.vencimento)
    FROM sponte_parcelas p
    JOIN regua_cobranca_etapas e ON e.ativo AND p.vencimento BETWEEN p_hoje - e.dias - 1 AND p_hoje - e.dias
    LEFT JOIN alunos a ON a.sponte_aluno_id = p.aluno_id
    LEFT JOIN sponte_alunos_contato c ON c.aluno_id = p.aluno_id
   WHERE p.situacao_parcela = 'Pendente'
     AND (p_canal <> 'whatsapp' OR COALESCE(e.whatsapp_template, '') <> '')
     AND EXISTS (SELECT 1 FROM sponte_matriculas m WHERE m.aluno_id = p.aluno_id AND m.situacao_id = 1)
     AND NOT EXISTS (SELECT 1 FROM regua_cobranca_envios v JOIN regua_cobranca_etapas e2 ON e2.id = v.etapa_id
                      WHERE v.conta_receber_id IS NOT DISTINCT FROM p.conta_receber_id
                        AND v.numero_parcela IS NOT DISTINCT FROM p.numero_parcela
                        AND v.canal = p_canal AND v.status = 'enviado' AND e2.dias >= e.dias)
   ORDER BY p.conta_receber_id, p.numero_parcela, e.dias DESC;
$$;
REVOKE ALL ON FUNCTION public.regua_cobranca_candidatos(date, text) FROM PUBLIC, anon, authenticated;
