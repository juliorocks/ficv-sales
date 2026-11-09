-- Papéis extras (2026-11-09): uma pessoa pode ter um papel principal (profiles.role) e papéis extras.
-- Caso de uso: secretaria que também atende o Comercial (Kanban de leads e conversas).
-- Só 'agent' é aceito como extra por enquanto; ampliar exige revisar is_admin() e as demais regras.
-- Os chamados continuam pela regra do papel principal (ticket_visible usa my_role()).

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS papeis_extra text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_papeis_extra_valido;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_papeis_extra_valido CHECK (papeis_extra <@ ARRAY['agent']::text[]);

-- só admin altera papel, principal ou extra (sem isso qualquer um se daria acesso pelo próprio perfil)
CREATE OR REPLACE FUNCTION public.guard_profile_role() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (NEW.role IS DISTINCT FROM OLD.role OR NEW.papeis_extra IS DISTINCT FROM OLD.papeis_extra)
     AND auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Só admin altera o papel de um usuário' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_profile_role ON profiles;
CREATE TRIGGER trg_guard_profile_role BEFORE UPDATE OF role, papeis_extra ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_role();

CREATE OR REPLACE FUNCTION public.is_staff() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid()
                   AND (role IN ('admin','agent') OR 'agent' = ANY(papeis_extra)));
$$;
