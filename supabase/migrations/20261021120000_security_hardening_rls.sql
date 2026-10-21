-- Endurecimento de RLS e funções (auditoria run-1, 2026-10-21).
-- Cada bloco fecha um caminho em que um usuário autenticado (inclusive aluno do Portal)
-- conseguia algo que só staff/admin deveria fazer. Chamadas do backend (service role,
-- auth.uid() nulo) continuam funcionando sem mudança.

-- 1) profiles: só admin cria perfil e só admin muda o papel.
--    Antes: profiles_upd deixava qualquer um alterar a própria linha (inclusive role) e
--    profiles_ins deixava qualquer conta autenticada criar um perfil com role='admin'.
DROP POLICY IF EXISTS profiles_ins ON profiles;
CREATE POLICY profiles_ins ON profiles FOR INSERT WITH CHECK (public.is_admin());

CREATE OR REPLACE FUNCTION public.guard_profile_role() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role AND auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Só admin altera o papel de um usuário' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_profile_role ON profiles;
CREATE TRIGGER trg_guard_profile_role BEFORE UPDATE OF role ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_role();

-- 2) alunos: o aluno altera só os próprios dados de contato e de controle de acesso
--    (must_change_password, last_login_at, app_instalado_em). Identidade e vínculo com o
--    Sponte (cpf, ra, nivel, sponte_aluno_id) são de staff/backend.
--    Antes: alunos_self_upd (sem WITH CHECK) deixava trocar o sponte_aluno_id e ver o
--    financeiro e as notas de outro aluno pelo Portal.
CREATE OR REPLACE FUNCTION public.guard_aluno_identity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() = OLD.id AND NOT public.is_ticket_staff() THEN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.cpf IS DISTINCT FROM OLD.cpf
       OR NEW.ra IS DISTINCT FROM OLD.ra
       OR NEW.nivel IS DISTINCT FROM OLD.nivel
       OR NEW.sponte_aluno_id IS DISTINCT FROM OLD.sponte_aluno_id THEN
      RAISE EXCEPTION 'Campo de vínculo acadêmico não pode ser alterado pelo aluno' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_aluno_identity ON alunos;
CREATE TRIGGER trg_guard_aluno_identity BEFORE UPDATE ON alunos
  FOR EACH ROW EXECUTE FUNCTION public.guard_aluno_identity();

-- 3) ticket_messages: só escreve no chamado que enxerga (dono ou staff com acesso à fila),
--    e aluno não escreve nota interna.
--    Antes: tmsg_insert checava só autor_id = auth.uid(), então um aluno escrevia em
--    chamado de outro aluno e como interno.
DROP POLICY IF EXISTS tmsg_insert ON ticket_messages;
CREATE POLICY tmsg_insert ON ticket_messages FOR INSERT WITH CHECK (
  autor_id = auth.uid() AND EXISTS (
    SELECT 1 FROM tickets t
     WHERE t.id = ticket_messages.ticket_id
       AND ((t.aluno_id = auth.uid() AND ticket_messages.interno = false)
            OR public.ticket_visible(t.queue_id, t.atendente_id, t.curso_id))));

-- 4) delete_stage_and_leads: apaga etapa e leads — só admin.
--    Antes: SECURITY DEFINER sem checagem, com EXECUTE para 'authenticated' (qualquer aluno).
CREATE OR REPLACE FUNCTION delete_stage_and_leads(stage_id_to_delete integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Só admin pode apagar uma etapa' USING ERRCODE = '42501';
  END IF;
  DELETE FROM leads  WHERE stage_id = stage_id_to_delete;
  DELETE FROM stages WHERE id = stage_id_to_delete;
END $$;
REVOKE ALL ON FUNCTION delete_stage_and_leads(integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION delete_stage_and_leads(integer) TO authenticated;
