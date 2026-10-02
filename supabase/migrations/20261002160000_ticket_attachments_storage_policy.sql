-- Reportado pelo usuário (02/10): enviar imagem/áudio no chat do Ticket falhava, sempre —
-- staff e aluno. Causa: o bucket `ticket-attachments` (criado como "público", só pra leitura
-- via URL pública) NUNCA ganhou uma policy de storage.objects pra INSERT — RLS fica ligado por
-- padrão em storage.objects, então sem policy nenhuma, NINGUÉM consegue subir arquivo ali,
-- mesmo com o bucket marcado como público (público só dispensa policy de LEITURA via URL
-- pública, nunca de escrita). TicketDetail.tsx guarda os arquivos em `${ticket.id}/nome` — a
-- policy usa esse 1º segmento do caminho (storage.foldername) pra achar o ticket e checar
-- acesso com a MESMA regra que já libera ver/editar o ticket em `tickets` (aluno dono OU
-- ticket_visible pra quem atende), em vez de um is_staff() genérico — consistente com o resto.
CREATE POLICY "ticket_attachments_insert" ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'ticket-attachments'
    AND EXISTS (
      SELECT 1 FROM tickets t
      WHERE t.id::text = (storage.foldername(name))[1]
        AND (t.aluno_id = auth.uid() OR public.ticket_visible(t.queue_id, t.atendente_id, t.curso_id::bigint))
    )
  );

-- Leitura via API direta (list/download) além da URL pública — mesma regra de cima.
CREATE POLICY "ticket_attachments_select" ON storage.objects FOR SELECT
  USING (
    bucket_id = 'ticket-attachments'
    AND EXISTS (
      SELECT 1 FROM tickets t
      WHERE t.id::text = (storage.foldername(name))[1]
        AND (t.aluno_id = auth.uid() OR public.ticket_visible(t.queue_id, t.atendente_id, t.curso_id::bigint))
    )
  );
