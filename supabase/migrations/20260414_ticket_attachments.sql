-- Adiciona coluna de anexos nas mensagens dos tickets
ALTER TABLE ticket_messages
  ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Cria bucket para arquivos de tickets (se não existir)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'ticket-attachments',
  'ticket-attachments',
  true,
  10485760,
  ARRAY['image/jpeg','image/png','image/gif','image/webp','application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/plain']
)
ON CONFLICT (id) DO NOTHING;

-- Políticas do bucket
DROP POLICY IF EXISTS "authenticated upload ticket attachments" ON storage.objects;
CREATE POLICY "authenticated upload ticket attachments"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'ticket-attachments');

DROP POLICY IF EXISTS "public read ticket attachments" ON storage.objects;
CREATE POLICY "public read ticket attachments"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'ticket-attachments');

DROP POLICY IF EXISTS "owner delete ticket attachments" ON storage.objects;
CREATE POLICY "owner delete ticket attachments"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'ticket-attachments' AND auth.uid() = owner);
