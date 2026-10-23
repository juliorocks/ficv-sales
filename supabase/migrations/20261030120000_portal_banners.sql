-- Banners de destaque do Portal do Aluno, geridos pelo admin. Cada banner tem arte para celular e/ou desktop,
-- link opcional e janela de exibição. O aluno só lê os ativos dentro da janela (RLS); só admin escreve.
CREATE TABLE IF NOT EXISTS public.portal_banners (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    titulo text NOT NULL,
    imagem_mobile text,
    imagem_desktop text,
    link_url text,
    ordem integer NOT NULL DEFAULT 0,
    ativo boolean NOT NULL DEFAULT true,
    inicio_em timestamptz,
    fim_em timestamptz,
    created_by uuid REFERENCES public.profiles(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT portal_banners_tem_imagem CHECK (imagem_mobile IS NOT NULL OR imagem_desktop IS NOT NULL),
    CONSTRAINT portal_banners_link_chk CHECK (link_url IS NULL OR link_url ~ '^(https://|/)')
);
CREATE INDEX IF NOT EXISTS portal_banners_ordem_idx ON public.portal_banners (ordem, created_at DESC);
ALTER TABLE public.portal_banners ENABLE ROW LEVEL SECURITY;

CREATE POLICY portal_banners_admin ON public.portal_banners FOR ALL TO authenticated
    USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY portal_banners_ver ON public.portal_banners FOR SELECT TO authenticated
    USING (ativo AND (inicio_em IS NULL OR inicio_em <= now()) AND (fim_em IS NULL OR fim_em > now()));

-- Artes: bucket público (leitura aberta); escrita só do admin
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('portal-banners', 'portal-banners', true, 3145728, ARRAY['image/png', 'image/jpeg', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY portal_banners_obj_insert ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'portal-banners' AND public.is_admin());
CREATE POLICY portal_banners_obj_update ON storage.objects FOR UPDATE TO authenticated
    USING (bucket_id = 'portal-banners' AND public.is_admin()) WITH CHECK (bucket_id = 'portal-banners' AND public.is_admin());
CREATE POLICY portal_banners_obj_delete ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'portal-banners' AND public.is_admin());
