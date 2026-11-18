-- Histórico do lead criado pelo "abrir no Kanban" (Inadimplência e Pré-matrícula), 2026-11-18.
-- O registro de criação dessas RPCs saía sem `changes`, então o histórico ficava vazio (e quebrava a tela).
-- Em vez de reescrever as duas funções, um gatilho completa o registro com os dados do lead (nome, telefone, fonte,
-- etapa, atendente, observações), no mesmo formato do lead criado pelo formulário.
SET statement_timeout = '120s';

CREATE OR REPLACE FUNCTION public.lead_changes_de_criacao(p_lead bigint) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('field', f, 'to', v)), '[]'::jsonb)
    FROM leads l,
    LATERAL (VALUES
      ('nome_completo', to_jsonb(l.nome_completo)), ('telefone', to_jsonb(l.telefone)),
      ('fonte_lead', to_jsonb(l.fonte_lead)), ('source_id', to_jsonb(l.source_id)),
      ('stage_id', to_jsonb(l.stage_id)), ('assigned_to_id', to_jsonb(l.assigned_to_id)),
      ('perfil', to_jsonb(l.perfil)), ('observacoes', to_jsonb(l.observacoes))
    ) AS x(f, v)
   WHERE l.id = p_lead AND v IS NOT NULL AND v <> 'null'::jsonb;
$$;
REVOKE ALL ON FUNCTION public.lead_changes_de_criacao(bigint) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.trg_audit_lead_criado_changes() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.details ? 'lead_id' AND NOT (NEW.details ? 'changes') THEN
    NEW.details := NEW.details || jsonb_build_object('changes', public.lead_changes_de_criacao((NEW.details ->> 'lead_id')::bigint));
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS audit_lead_criado_changes ON public.audit_logs;
CREATE TRIGGER audit_lead_criado_changes BEFORE INSERT ON public.audit_logs
  FOR EACH ROW WHEN (NEW.action = 'lead_created' AND NEW.details ->> 'origem' IN ('inadimplencia', 'pre_matricula'))
  EXECUTE FUNCTION public.trg_audit_lead_criado_changes();

-- Cards já criados pela Inadimplência desde 09/11.
UPDATE public.audit_logs a
   SET details = a.details || jsonb_build_object('changes', public.lead_changes_de_criacao((a.details ->> 'lead_id')::bigint))
 WHERE a.action = 'lead_created' AND a.details ->> 'origem' IN ('inadimplencia', 'pre_matricula')
   AND NOT (a.details ? 'changes');
