-- 17/11: quem foi matriculado depois de um atendimento é consequência dele. Cruza as matrículas do Sponte
-- (Vigente/Pré Matrícula) com os leads (telefone do Sponte ou do Portal, ou nome completo) e atribui a
-- matrícula ao agente que mais falou com o lead nos 60 dias antes. O celular do Sponte vem vazio desde ago/2026,
-- por isso o telefone do Portal (alunos.telefone) entra como segunda fonte.
CREATE TABLE IF NOT EXISTS matricula_atribuicao (
  contrato_id integer PRIMARY KEY,
  aluno text,
  data_matricula date NOT NULL,
  nome_curso text,
  lead_id integer NOT NULL,
  via text NOT NULL,                 -- 'fone' ou 'nome'
  agente_nome text,
  agente_id uuid,
  n_msgs integer NOT NULL DEFAULT 0,
  ultima_msg timestamptz,
  calculado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_matricula_atribuicao_lead ON matricula_atribuicao (lead_id);
ALTER TABLE matricula_atribuicao ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS matricula_atribuicao_sel ON matricula_atribuicao;
CREATE POLICY matricula_atribuicao_sel ON matricula_atribuicao FOR SELECT USING (is_staff());

ALTER TABLE messages_logs ADD COLUMN IF NOT EXISTS convertido boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.atribuir_matriculas(p_desde date DEFAULT '2026-09-25')
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n integer;
BEGIN
  WITH mat AS (
    SELECT sm.contrato_id, sm.aluno, sm.data_matricula, sm.nome_curso,
           public.phone_ddd8(coalesce(nullif(sm.celular,''), a.telefone)) fone,
           regexp_replace(lower(translate(sm.aluno,'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ','aaaaaeeeeiiiiooooouuuucnaaaaaeeeeiiiiooooouuuucn')),'[^a-z ]','','g') nome
      FROM sponte_matriculas sm LEFT JOIN alunos a ON a.sponte_aluno_id = sm.aluno_id
     WHERE sm.data_matricula >= p_desde AND sm.situacao_id IN (1,6)
  ), ld AS (
    SELECT l.id lead_id, public.phone_ddd8(l.telefone) fone,
           regexp_replace(lower(translate(l.nome_completo,'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ','aaaaaeeeeiiiiooooouuuucnaaaaaeeeeiiiiooooouuuucn')),'[^a-z ]','','g') nome
      FROM leads l
  ), par AS (
    SELECT m.*, l.lead_id,
           CASE WHEN m.fone IS NOT NULL AND m.fone = l.fone THEN 'fone' ELSE 'nome' END via
      FROM mat m JOIN ld l ON (m.fone IS NOT NULL AND m.fone = l.fone)
        OR (array_length(string_to_array(trim(m.nome),' '),1) >= 2 AND m.nome = l.nome)
  ), falas AS (
    SELECT p.contrato_id, p.lead_id, w.sender_name, pr.id agente_id, count(*) qtd, max(w.created_at) ultima
      FROM par p
      JOIN widechat_messages w ON w.lead_id = p.lead_id AND w.origin = 'agent' AND w.interno IS NOT TRUE
       AND w.created_at >= p.data_matricula - interval '60 days' AND w.created_at < p.data_matricula + interval '1 day'
       AND coalesce(w.message,'') !~* 'vamos (continuar|contnuar|dar continuidade)|dando continuidade ao seu atendimento|basta responder'
      JOIN profiles pr ON lower(trim(pr.full_name)) = lower(trim(w.sender_name))
     GROUP BY 1,2,3,4
  ), melhor AS (
    SELECT DISTINCT ON (contrato_id) contrato_id, lead_id, sender_name, agente_id, qtd, ultima
      FROM falas WHERE qtd >= 2 ORDER BY contrato_id, qtd DESC, ultima DESC
  )
  INSERT INTO matricula_atribuicao (contrato_id, aluno, data_matricula, nome_curso, lead_id, via, agente_nome, agente_id, n_msgs, ultima_msg, calculado_em)
  SELECT DISTINCT ON (p.contrato_id) p.contrato_id, p.aluno, p.data_matricula, p.nome_curso, b.lead_id, p.via, b.sender_name, b.agente_id, b.qtd, b.ultima, now()
    FROM par p JOIN melhor b ON b.contrato_id = p.contrato_id AND b.lead_id = p.lead_id
   ORDER BY p.contrato_id, (p.via = 'fone') DESC
  ON CONFLICT (contrato_id) DO UPDATE SET lead_id = EXCLUDED.lead_id, via = EXCLUDED.via, agente_nome = EXCLUDED.agente_nome,
    agente_id = EXCLUDED.agente_id, n_msgs = EXCLUDED.n_msgs, ultima_msg = EXCLUDED.ultima_msg, data_matricula = EXCLUDED.data_matricula, calculado_em = now();
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.atribuir_matriculas(date) FROM PUBLIC, anon, authenticated;

SELECT cron.unschedule('matricula-atribuicao') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'matricula-atribuicao');
SELECT cron.schedule('matricula-atribuicao', '20 * * * *', $$SELECT public.atribuir_matriculas()$$);
