-- Inadimplência → Kanban (2026-11-09): da lista de inadimplentes, a pessoa abre o card do aluno no
-- Kanban dela (etapa Em Contato) para disparar o template ficv_inadimplentes e começar a conversa.
--
-- Cuidados:
--  * NÃO preenche preferred_contact: o gatilho vivaconnect_enqueue_first_message só manda a saudação da
--    Vivi quando preferred_contact = 'whatsapp'. O contato aqui é humano, com template.
--  * Canal 8 (CIDADE VIVA - OFICIAL): o ficv_inadimplentes só existe no WABA desse canal.
--  * Em Contato: o webhook (aluno em atendimento humano) e o cron do Sponte não tiram o card dali.
--  * Mesmo critério do webhook para achar o lead: os 8 últimos dígitos do telefone (findLeadByPhone).
--  * Lead de outra pessoa não é reatribuído nem movido.

-- Quem da lista de inadimplentes já tem card no Kanban (etapa e atendente). Sem acesso ao Kanban: vazio.
CREATE OR REPLACE FUNCTION public.inadimplencia_kanban() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_staff() THEN RETURN '[]'::jsonb; END IF;
  RETURN coalesce((
    WITH devedores AS (
      SELECT DISTINCT aluno_id FROM sponte_parcelas
       WHERE situacao_parcela = 'Pendente' AND vencimento < current_date AND aluno_id IS NOT NULL
    ), mat AS (
      SELECT DISTINCT ON (m.aluno_id) m.aluno_id, right(regexp_replace(coalesce(m.celular, ''), '\D', '', 'g'), 8) AS suf
        FROM sponte_matriculas m JOIN devedores d ON d.aluno_id = m.aluno_id
       ORDER BY m.aluno_id, (m.situacao_id = 1) DESC, m.data_matricula DESC NULLS LAST
    ), ld AS (
      SELECT DISTINCT ON (suf) suf, id, stage_id, assigned_to_id
        FROM (SELECT l.id, l.stage_id, l.assigned_to_id, right(regexp_replace(coalesce(l.telefone, ''), '\D', '', 'g'), 8) AS suf FROM leads l) x
       WHERE length(suf) = 8
       ORDER BY suf, id DESC
    )
    SELECT jsonb_agg(jsonb_build_object(
             'aluno_id', mat.aluno_id, 'lead_id', ld.id, 'stage_id', ld.stage_id, 'stage', s.name,
             'owner_id', ld.assigned_to_id, 'owner', p.full_name))
      FROM mat
      JOIN ld ON ld.suf = mat.suf AND length(mat.suf) = 8
      LEFT JOIN stages s ON s.id = ld.stage_id
      LEFT JOIN profiles p ON p.id = ld.assigned_to_id
  ), '[]'::jsonb);
END $$;
GRANT EXECUTE ON FUNCTION public.inadimplencia_kanban() TO authenticated;

-- Abre (ou reaproveita) o card do aluno inadimplente no Kanban de quem chamou, em Em Contato.
CREATE OR REPLACE FUNCTION public.inadimplencia_abrir_lead(p_aluno_id bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_em_contato int;
  m record;
  v_digits text;
  v_lead record;
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

  SELECT aluno, celular, nome_curso, nome_turma INTO m FROM sponte_matriculas
   WHERE aluno_id = p_aluno_id ORDER BY (situacao_id = 1) DESC, data_matricula DESC NULLS LAST LIMIT 1;
  v_digits := regexp_replace(coalesce(m.celular, ''), '\D', '', 'g');
  IF length(v_digits) < 10 THEN RAISE EXCEPTION 'Este aluno não tem celular válido no Sponte'; END IF;
  IF length(v_digits) IN (10, 11) THEN v_digits := '55' || v_digits; END IF;

  SELECT id, stage_id, assigned_to_id, vivaconnect_channel_id INTO v_lead FROM leads
   WHERE right(regexp_replace(coalesce(telefone, ''), '\D', '', 'g'), 8) = right(v_digits, 8)
   ORDER BY id DESC LIMIT 1;

  IF FOUND THEN
    v_id := v_lead.id;
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
                       temperatura, assigned_to_id, perfil, vivaconnect_channel_id, from_marketing_form)
    VALUES (coalesce(m.aluno, 'Aluno ' || p_aluno_id), v_digits, 'Inadimplência', 9,
            'Aluno inadimplente (Sponte ' || p_aluno_id || ')' || coalesce(' — ' || m.nome_curso, '') || coalesce(' / ' || m.nome_turma, ''),
            v_em_contato, now(), now(), 'frio', v_uid, 'aluno', 8, false)
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
GRANT EXECUTE ON FUNCTION public.inadimplencia_abrir_lead(bigint) TO authenticated;
