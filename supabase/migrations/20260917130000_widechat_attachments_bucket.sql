-- Bucket pra arquivo/áudio que o agente manda pro lead via WideChat (Kanban >
-- Conversas). O navegador sobe aqui primeiro; a edge function widechat-api
-- baixa daqui e repassa pro WideChat (fica cópia/histórico do que foi enviado).
-- Limite de tamanho e mime types seguem perto do que o WhatsApp aceita
-- (imagem/doc/áudio comuns — vídeo fica pra depois, não faz parte do escopo
-- atual do botão de anexo).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'widechat-attachments', 'widechat-attachments', true, 26214400,
  ARRAY[
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/mp3', 'audio/wav'
  ]
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "authenticated upload widechat attachments" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'widechat-attachments');

CREATE POLICY "public read widechat attachments" ON storage.objects
  FOR SELECT TO public USING (bucket_id = 'widechat-attachments');

CREATE POLICY "owner delete widechat attachments" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'widechat-attachments' AND auth.uid() = owner);
