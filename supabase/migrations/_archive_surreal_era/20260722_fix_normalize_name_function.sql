-- Corrige normalize_name: a forma unaccent(regdictionary, text) não resolveu
-- o tipo do literal 'unaccent' neste contexto — usa a forma unaccent(text)
-- (dicionário padrão), que funciona sem cast explícito.
CREATE OR REPLACE FUNCTION normalize_name(name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(regexp_replace(trim(unaccent(coalesce(name, ''))), '\s+', ' ', 'g'));
$$;
