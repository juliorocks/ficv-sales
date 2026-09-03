-- Adiciona tipos de áudio ao bucket ticket-attachments
UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'image/jpeg','image/png','image/gif','image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/mpeg'
]
WHERE id = 'ticket-attachments';
