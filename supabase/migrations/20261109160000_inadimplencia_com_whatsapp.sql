-- Filtro "com WhatsApp" da lista de inadimplentes (2026-11-09): quais alunos têm telefone para a conversa.
-- Mesmas fontes do botão (inadimplencia_abrir_lead): celular de qualquer matrícula, telefone da conta do
-- Portal e card do Kanban já ligado ao aluno (número digitado à mão). Sem acesso ao Kanban: vazio.
CREATE OR REPLACE FUNCTION public.inadimplencia_com_whatsapp() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_staff() THEN RETURN '[]'::jsonb; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(d.aluno_id)
      FROM (SELECT DISTINCT aluno_id FROM sponte_parcelas
             WHERE situacao_parcela = 'Pendente' AND vencimento < current_date AND aluno_id IS NOT NULL) d
     WHERE EXISTS (SELECT 1 FROM sponte_matriculas m
                    WHERE m.aluno_id = d.aluno_id AND length(regexp_replace(coalesce(m.celular, ''), '\D', '', 'g')) >= 10)
        OR EXISTS (SELECT 1 FROM alunos a
                    WHERE a.sponte_aluno_id = d.aluno_id AND length(regexp_replace(coalesce(a.telefone, ''), '\D', '', 'g')) >= 10)
        OR EXISTS (SELECT 1 FROM leads l WHERE l.sponte_aluno_id = d.aluno_id)
  ), '[]'::jsonb);
END $$;
GRANT EXECUTE ON FUNCTION public.inadimplencia_com_whatsapp() TO authenticated;
