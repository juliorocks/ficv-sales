-- Inadimplência → Kanban, telefone e vínculo com o aluno (2026-11-09).
-- Achado ao vivo: 1.577 de 1.827 inadimplentes não têm celular na matrícula escolhida pela lista, então o botão
-- nem aparecia. Agora o telefone vem de qualquer matrícula do aluno, depois da conta do Portal, e, se não existir
-- em lugar nenhum, a pessoa informa o número ao abrir. O card fica ligado ao aluno do Sponte (leads.sponte_aluno_id),
-- para o indicador da lista funcionar mesmo quando o número foi digitado à mão.

ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS sponte_aluno_id bigint;
CREATE INDEX IF NOT EXISTS leads_sponte_aluno_id_idx ON public.leads (sponte_aluno_id) WHERE sponte_aluno_id IS NOT NULL;

-- Telefone do aluno com 55: celular de qualquer matrícula (Vigente primeiro, mais recente) e, se nenhuma tiver,
-- o da conta do Portal. Uso interno das funções abaixo (devolve dado de contato), por isso sem acesso direto.
CREATE OR REPLACE FUNCTION public.inadimplencia_telefone(p_aluno_id bigint) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN length(dig) IN (10, 11) THEN '55' || dig ELSE dig END
    FROM (
      SELECT regexp_replace(coalesce(m.celular, ''), '\D', '', 'g') AS dig, 1 AS prio, (m.situacao_id = 1) AS vig, m.data_matricula AS dt
        FROM sponte_matriculas m WHERE m.aluno_id = p_aluno_id
      UNION ALL
      SELECT regexp_replace(coalesce(a.telefone, ''), '\D', '', 'g'), 2, false, NULL
        FROM alunos a WHERE a.sponte_aluno_id = p_aluno_id
    ) x
   WHERE length(dig) >= 10
   ORDER BY prio, vig DESC, dt DESC NULLS LAST
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.inadimplencia_telefone(bigint) FROM PUBLIC, anon, authenticated;

-- Quem da lista de inadimplentes já tem card no Kanban: pelo vínculo com o aluno ou pelo telefone.
CREATE OR REPLACE FUNCTION public.inadimplencia_kanban() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_staff() THEN RETURN '[]'::jsonb; END IF;
  RETURN coalesce((
    WITH devedores AS (
      SELECT DISTINCT aluno_id FROM sponte_parcelas
       WHERE situacao_parcela = 'Pendente' AND vencimento < current_date AND aluno_id IS NOT NULL
    ), por_id AS (
      SELECT DISTINCT ON (l.sponte_aluno_id) l.sponte_aluno_id AS aluno_id, l.id, l.stage_id, l.assigned_to_id
        FROM leads l JOIN devedores d ON d.aluno_id = l.sponte_aluno_id
       ORDER BY l.sponte_aluno_id, l.id DESC
    ), fones AS (
      SELECT DISTINCT d.aluno_id, right(x.dig, 8) AS suf
        FROM devedores d
        JOIN LATERAL (
          SELECT regexp_replace(coalesce(m.celular, ''), '\D', '', 'g') AS dig FROM sponte_matriculas m WHERE m.aluno_id = d.aluno_id
          UNION ALL
          SELECT regexp_replace(coalesce(a.telefone, ''), '\D', '', 'g') FROM alunos a WHERE a.sponte_aluno_id = d.aluno_id
        ) x ON length(x.dig) >= 10
    ), ld AS (
      SELECT DISTINCT ON (suf) suf, id, stage_id, assigned_to_id
        FROM (SELECT l.id, l.stage_id, l.assigned_to_id, right(regexp_replace(coalesce(l.telefone, ''), '\D', '', 'g'), 8) AS suf FROM leads l) y
       WHERE length(suf) = 8
       ORDER BY suf, id DESC
    ), por_tel AS (
      SELECT DISTINCT ON (f.aluno_id) f.aluno_id, ld.id, ld.stage_id, ld.assigned_to_id
        FROM fones f JOIN ld ON ld.suf = f.suf
       WHERE f.aluno_id NOT IN (SELECT aluno_id FROM por_id)
       ORDER BY f.aluno_id, ld.id DESC
    ), todos AS (
      SELECT * FROM por_id UNION ALL SELECT * FROM por_tel
    )
    SELECT jsonb_agg(jsonb_build_object(
             'aluno_id', t.aluno_id, 'lead_id', t.id, 'stage_id', t.stage_id, 'stage', s.name,
             'owner_id', t.assigned_to_id, 'owner', p.full_name))
      FROM todos t
      LEFT JOIN stages s ON s.id = t.stage_id
      LEFT JOIN profiles p ON p.id = t.assigned_to_id
  ), '[]'::jsonb);
END $$;
GRANT EXECUTE ON FUNCTION public.inadimplencia_kanban() TO authenticated;

-- Abre (ou reaproveita) o card do aluno no Kanban de quem chamou, em Em Contato.
-- Sem telefone em lugar nenhum: erro 'SEM_CELULAR' e o app pede o número (p_telefone).
DROP FUNCTION IF EXISTS public.inadimplencia_abrir_lead(bigint);
CREATE OR REPLACE FUNCTION public.inadimplencia_abrir_lead(p_aluno_id bigint, p_telefone text DEFAULT NULL) RETURNS jsonb
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

  IF NOT EXISTS (SELECT 1 FROM sponte_parcelas WHERE aluno_id = p_aluno_id AND situacao_parcela = 'Pendente' AND vencimento < current_date) THEN
    RAISE EXCEPTION 'Este aluno não tem parcela vencida em aberto';
  END IF;

  SELECT aluno, nome_curso, nome_turma INTO m FROM sponte_matriculas
   WHERE aluno_id = p_aluno_id ORDER BY (situacao_id = 1) DESC, data_matricula DESC NULLS LAST LIMIT 1;

  -- 1º o card já ligado ao aluno (não precisa de telefone); 2º o lead com o mesmo telefone
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
    VALUES (coalesce(m.aluno, 'Aluno ' || p_aluno_id), v_digits, 'Inadimplência', 9,
            'Aluno inadimplente (Sponte ' || p_aluno_id || ')' || coalesce(' — ' || m.nome_curso, '') || coalesce(' / ' || m.nome_turma, ''),
            v_em_contato, now(), now(), 'frio', v_uid, 'aluno', 8, false, p_aluno_id)
    RETURNING id INTO v_id;
    v_criado := true;
    INSERT INTO audit_logs (user_id, action, details)
    VALUES (v_uid, 'lead_created', jsonb_build_object('lead_id', v_id, 'origem', 'inadimplencia', 'aluno_id', p_aluno_id));
  END IF;

  SELECT l.stage_id, l.assigned_to_id, l.vivaconnect_channel_id INTO v_stage, v_owner, v_canal FROM leads l WHERE l.id = v_id;
  RETURN jsonb_build_object(
    'lead_id', v_id, 'criado', v_criado, 'outro_dono', v_outro_dono, 'canal_id', v_canal,
    'stage', (SELECT name FROM stages WHERE id = v_stage),
    'owner', (SELECT full_name FROM profiles WHERE id = v_owner));
END $$;
GRANT EXECUTE ON FUNCTION public.inadimplencia_abrir_lead(bigint, text) TO authenticated;
