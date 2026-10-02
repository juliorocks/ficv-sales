-- Pedido do usuário (02/10): poder apagar uma mensagem enviada no chat do Ticket (print: nota
-- interna "aluno chato" mandada sem querer). Apagamento é "soft delete" (deleted_at/deleted_by),
-- não DELETE de verdade — mantém rastro de auditoria igual o resto do sistema (lead_notes nunca
-- são apagadas, audit_logs idem); o front troca o conteúdo por "Mensagem apagada" quando
-- deleted_at estiver preenchido, em vez de sumir a linha da conversa.
ALTER TABLE ticket_messages
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES profiles(id);

-- Só quem mandou a mensagem (e é staff) ou um admin pode apagar — aluno não apaga a própria fala
-- do ticket (fica como registro do atendimento, igual sempre foi; só a equipe tem esse botão).
-- "é staff" aqui = tem linha em profiles (aluno não tem — alunos ficam na tabela `alunos`, nunca
-- em `profiles`); is_staff() foi testado ao vivo e é MUITO restrito pra isso (só admin/agent) —
-- um coordenador (role existe de verdade em profiles, usado por ticket_visible()) ficou de fora
-- e não conseguia apagar a própria mensagem.
CREATE POLICY "tmsg_delete" ON ticket_messages FOR UPDATE
  USING (
    (autor_id = auth.uid() AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid()))
    OR public.is_admin()
  )
  WITH CHECK (
    (autor_id = auth.uid() AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid()))
    OR public.is_admin()
  );
