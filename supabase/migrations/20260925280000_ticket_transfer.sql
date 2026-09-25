-- ============================================================================
-- Transferência Comercial → Secretaria (lead do WhatsApp vira chamado do Portal)
-- + resposta do aluno direto pelo e-mail (Resend inbound).
--
-- tickets.lead_id      → histórico da conversa do WhatsApp aparece no chamado
-- tickets.origem       → 'portal' (aluno abriu) | 'transferencia' (equipe transferiu) | 'email'
-- tickets.aluno_id     → passa a aceitar NULL: aluno transferido que ainda não é
--                        aluno no Sponte (sem acesso ao portal) segue só por e-mail
-- ticket_email_outbox  → novo tipo 'transferred' (substitui 'created' na transferência)
-- app_internal.inbound_key → assina o endereço de resposta de cada chamado
-- ============================================================================

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS lead_id          integer REFERENCES leads(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS origem           text NOT NULL DEFAULT 'portal' CHECK (origem IN ('portal','transferencia','email')),
  ADD COLUMN IF NOT EXISTS transferido_por  uuid REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE tickets ALTER COLUMN aluno_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tickets_lead ON tickets (lead_id) WHERE lead_id IS NOT NULL;

ALTER TABLE ticket_email_outbox DROP CONSTRAINT IF EXISTS ticket_email_outbox_kind_check;
ALTER TABLE ticket_email_outbox ADD CONSTRAINT ticket_email_outbox_kind_check
  CHECK (kind IN ('created','transferred','reply','resolved','reminder'));

INSERT INTO app_internal (key, value) VALUES ('inbound_key', encode(extensions.gen_random_bytes(24), 'hex'))
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.ticket_email_on_ticket() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.aluno_id IS NOT NULL OR coalesce(NEW.aluno_email, '') <> '' THEN
      INSERT INTO ticket_email_outbox (ticket_id, kind)
      VALUES (NEW.id, CASE WHEN NEW.origem = 'transferencia' THEN 'transferred' ELSE 'created' END)
      ON CONFLICT DO NOTHING;
    END IF;
  ELSIF NEW.status = 'resolvido' AND OLD.status IS DISTINCT FROM 'resolvido' THEN
    INSERT INTO ticket_email_outbox (ticket_id, kind, scheduled_at)
    VALUES (NEW.id, 'resolved', now() + interval '5 minutes') ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

-- resposta por e-mail de aluno SEM conta no portal (transferido, fora do Sponte) → sem autor_id
ALTER TABLE ticket_messages ALTER COLUMN autor_id DROP NOT NULL;
