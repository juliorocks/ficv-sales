-- Pré-matrícula: lista para o Comercial ajudar a concluir o processo (2026-11-18).
-- Drilldown do cartão "Pré-Matrícula" do SponteDashboard: quem são, em que situação estão, quem já foi
-- contatado (checkbox) e abrir a conversa no Kanban com template. Acesso só por estas RPCs (is_staff()).
SET statement_timeout = '120s';

CREATE TABLE IF NOT EXISTS public.pre_matricula_contatos (
  contrato_id  bigint PRIMARY KEY,
  aluno_id     bigint,
  contatado    boolean NOT NULL DEFAULT false,
  contatado_por uuid,
  contatado_em timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.pre_matricula_contatos ENABLE ROW LEVEL SECURITY;

-- Uma linha por contrato em Pré-Matrícula (situacao_id 6), com a situação do aluno.
CREATE OR REPLACE FUNCTION public.pre_matricula_report() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_staff() THEN RETURN '[]'::jsonb; END IF;
  RETURN coalesce((
    WITH pre AS (
      SELECT m.contrato_id, m.aluno_id, m.aluno, m.nome_curso, m.nome_turma, m.data_matricula, m.data_inicio, m.financeiro_lancado
        FROM sponte_matriculas m WHERE m.situacao_id = 6
    ), par AS (
      SELECT p.aluno_id,
             count(*) FILTER (WHERE p.situacao_parcela = 'Quitada') AS pagas,
             count(*) FILTER (WHERE p.situacao_parcela = 'Pendente') AS abertas,
             count(*) FILTER (WHERE p.situacao_parcela = 'Pendente' AND p.vencimento < current_date) AS vencidas,
             min(p.vencimento) FILTER (WHERE p.situacao_parcela = 'Pendente') AS proximo
        FROM sponte_parcelas p WHERE p.aluno_id IN (SELECT aluno_id FROM pre) GROUP BY p.aluno_id
    ), base AS (
      SELECT pre.*, par.pagas, par.abertas, par.vencidas, par.proximo,
             public.inadimplencia_telefone(pre.aluno_id) AS fone,
             EXISTS (SELECT 1 FROM alunos a WHERE a.sponte_aluno_id = pre.aluno_id) AS tem_portal
        FROM pre LEFT JOIN par ON par.aluno_id = pre.aluno_id
    ), lead AS (
      SELECT b.contrato_id,
             coalesce(
               (SELECT l.id FROM leads l WHERE l.sponte_aluno_id = b.aluno_id ORDER BY l.id DESC LIMIT 1),
               (SELECT l.id FROM leads l WHERE b.fone IS NOT NULL
                   AND right(regexp_replace(coalesce(l.telefone, ''), '\D', '', 'g'), 8) = right(b.fone, 8)
                 ORDER BY l.id DESC LIMIT 1)) AS lead_id
        FROM base b
    )
    SELECT jsonb_agg(jsonb_build_object(
             'contrato_id', b.contrato_id, 'aluno_id', b.aluno_id, 'aluno', b.aluno,
             'curso', b.nome_curso, 'turma', b.nome_turma,
             'data_matricula', b.data_matricula, 'data_inicio', b.data_inicio,
             'financeiro_lancado', b.financeiro_lancado,
             'pagas', coalesce(b.pagas, 0), 'abertas', coalesce(b.abertas, 0), 'vencidas', coalesce(b.vencidas, 0),
             'proximo', b.proximo, 'tem_portal', b.tem_portal, 'tem_telefone', b.fone IS NOT NULL,
             'lead_id', ld.id, 'stage', s.name, 'owner', po.full_name,
             'contatado', coalesce(c.contatado, false), 'contatado_por', pc.full_name, 'contatado_em', c.contatado_em)
           ORDER BY b.data_matricula DESC NULLS LAST)
      FROM base b
      LEFT JOIN lead x ON x.contrato_id = b.contrato_id
      LEFT JOIN leads ld ON ld.id = x.lead_id
      LEFT JOIN stages s ON s.id = ld.stage_id
      LEFT JOIN profiles po ON po.id = ld.assigned_to_id
      LEFT JOIN pre_matricula_contatos c ON c.contrato_id = b.contrato_id
      LEFT JOIN profiles pc ON pc.id = c.contatado_por
  ), '[]'::jsonb);
END $$;
GRANT EXECUTE ON FUNCTION public.pre_matricula_report() TO authenticated;

-- Marca/desmarca "já contatado" (quem e quando ficam registrados).
CREATE OR REPLACE FUNCTION public.pre_matricula_marcar(p_contrato_id bigint, p_contatado boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT public.is_staff() THEN RAISE EXCEPTION 'Sem acesso' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM sponte_matriculas WHERE contrato_id = p_contrato_id AND situacao_id = 6) THEN
    RAISE EXCEPTION 'Contrato não está em pré-matrícula';
  END IF;
  INSERT INTO pre_matricula_contatos (contrato_id, aluno_id, contatado, contatado_por, contatado_em, updated_at)
  VALUES (p_contrato_id, (SELECT aluno_id FROM sponte_matriculas WHERE contrato_id = p_contrato_id LIMIT 1),
          p_contatado, CASE WHEN p_contatado THEN v_uid END, CASE WHEN p_contatado THEN now() END, now())
  ON CONFLICT (contrato_id) DO UPDATE
     SET contatado = EXCLUDED.contatado, contatado_por = EXCLUDED.contatado_por,
         contatado_em = EXCLUDED.contatado_em, updated_at = now();
  RETURN jsonb_build_object('contatado', p_contatado,
    'por', (SELECT full_name FROM profiles WHERE id = v_uid));
END $$;
GRANT EXECUTE ON FUNCTION public.pre_matricula_marcar(bigint, boolean) TO authenticated;

-- Abre (ou reaproveita) o card do aluno em pré-matrícula no Kanban de quem chamou, em Em Contato.
-- Mesmas regras da Inadimplência (inadimplencia_abrir_lead): sem preferred_contact (a Vivi não manda saudação),
-- canal 8 (CIDADE VIVA - OFICIAL), lead de OUTRA pessoa não é movido nem reatribuído, SEM_CELULAR pede o número.
CREATE OR REPLACE FUNCTION public.pre_matricula_abrir_lead(p_aluno_id bigint, p_telefone text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_em_contato int;
  m record;
  v_digits text;
  v_manual text := regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g');
  v_lead record;
  v_achou boolean := false;
  v_id bigint;
  v_criado boolean := false;
  v_outro_dono boolean := false;
  v_canal int;
  v_stage int;
  v_owner uuid;
BEGIN
  IF v_uid IS NULL OR NOT public.is_staff() THEN
    RAISE EXCEPTION 'Sem acesso ao Kanban' USING ERRCODE = '42501';
  END IF;
  SELECT id INTO v_em_contato FROM stages WHERE name = 'Em Contato' LIMIT 1;
  IF v_em_contato IS NULL THEN RAISE EXCEPTION 'Etapa Em Contato não encontrada'; END IF;

  SELECT aluno, nome_curso, nome_turma INTO m FROM sponte_matriculas
   WHERE aluno_id = p_aluno_id AND situacao_id = 6 ORDER BY data_matricula DESC NULLS LAST LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Este aluno não está em pré-matrícula'; END IF;

  SELECT id, stage_id, assigned_to_id, vivaconnect_channel_id INTO v_lead FROM leads
   WHERE sponte_aluno_id = p_aluno_id ORDER BY id DESC LIMIT 1;
  v_achou := FOUND;

  IF NOT v_achou THEN
    IF v_manual <> '' THEN
      IF length(v_manual) IN (10, 11) THEN v_manual := '55' || v_manual; END IF;
      IF length(v_manual) NOT IN (12, 13) OR left(v_manual, 2) <> '55' THEN
        RAISE EXCEPTION 'Número inválido. Informe o DDD e o telefone.';
      END IF;
      v_digits := v_manual;
    ELSE
      v_digits := public.inadimplencia_telefone(p_aluno_id);
      IF v_digits IS NULL THEN RAISE EXCEPTION 'SEM_CELULAR' USING ERRCODE = 'P0001'; END IF;
    END IF;
    SELECT id, stage_id, assigned_to_id, vivaconnect_channel_id INTO v_lead FROM leads
     WHERE right(regexp_replace(coalesce(telefone, ''), '\D', '', 'g'), 8) = right(v_digits, 8)
     ORDER BY id DESC LIMIT 1;
    v_achou := FOUND;
  END IF;

  IF v_achou THEN
    v_id := v_lead.id;
    UPDATE leads SET sponte_aluno_id = p_aluno_id WHERE id = v_id AND sponte_aluno_id IS NULL;
    IF v_lead.assigned_to_id IS NULL OR v_lead.assigned_to_id = v_uid THEN
      IF v_lead.stage_id IS DISTINCT FROM v_em_contato THEN
        UPDATE leads SET stage_id = v_em_contato, stage_entry_date = now(), assigned_to_id = v_uid,
               vivaconnect_channel_id = coalesce(vivaconnect_channel_id, 8), updated_at = now()
         WHERE id = v_id;
        INSERT INTO lead_history (lead_id, from_stage_id, to_stage_id, changed_by, changed_at)
        VALUES (v_id, v_lead.stage_id, v_em_contato, v_uid, now());
      ELSIF v_lead.assigned_to_id IS NULL OR v_lead.vivaconnect_channel_id IS NULL THEN
        UPDATE leads SET assigned_to_id = v_uid, vivaconnect_channel_id = coalesce(vivaconnect_channel_id, 8), updated_at = now()
         WHERE id = v_id;
      END IF;
    ELSE
      v_outro_dono := true;
    END IF;
  ELSE
    INSERT INTO leads (nome_completo, telefone, fonte_lead, source_id, observacoes, stage_id, stage_entry_date, data_entrada,
                       temperatura, assigned_to_id, perfil, vivaconnect_channel_id, from_marketing_form, sponte_aluno_id)
    VALUES (coalesce(m.aluno, 'Aluno ' || p_aluno_id), v_digits, 'Pré-Matrícula', 9,
            'Pré-matrícula no Sponte (' || p_aluno_id || ')' || coalesce(' — ' || m.nome_curso, '') || coalesce(' / ' || m.nome_turma, ''),
            v_em_contato, now(), now(), 'frio', v_uid, 'aluno', 8, false, p_aluno_id)
    RETURNING id INTO v_id;
    v_criado := true;
    INSERT INTO audit_logs (user_id, action, details)
    VALUES (v_uid, 'lead_created', jsonb_build_object('lead_id', v_id, 'origem', 'pre_matricula', 'aluno_id', p_aluno_id));
  END IF;

  SELECT l.stage_id, l.assigned_to_id, l.vivaconnect_channel_id INTO v_stage, v_owner, v_canal FROM leads l WHERE l.id = v_id;
  RETURN jsonb_build_object(
    'lead_id', v_id, 'criado', v_criado, 'outro_dono', v_outro_dono, 'canal_id', v_canal,
    'stage', (SELECT name FROM stages WHERE id = v_stage),
    'owner', (SELECT full_name FROM profiles WHERE id = v_owner));
END $$;
GRANT EXECUTE ON FUNCTION public.pre_matricula_abrir_lead(bigint, text) TO authenticated;
