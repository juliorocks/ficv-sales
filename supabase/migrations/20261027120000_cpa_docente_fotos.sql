-- Foto do professor enviada pela equipe no painel da CPA (o Moodle só devolve a imagem padrão).
-- Bucket público: a leitura é pública; a escrita só pela service role (edge function cpa-admin).
INSERT INTO storage.buckets (id, name, public) VALUES ('cpa-docentes', 'cpa-docentes', true)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.cpa_docente_fotos (
    nome text PRIMARY KEY,
    foto_path text NOT NULL,
    atualizado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.cpa_docente_fotos ENABLE ROW LEVEL SECURITY;
CREATE POLICY cpa_docente_fotos_staff ON public.cpa_docente_fotos FOR SELECT TO authenticated USING (public.is_staff());
