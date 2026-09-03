-- unaccent está instalada no schema "public" (confirmado via diagnóstico).
-- SET search_path fixa explicitamente o schema de resolução da função,
-- independente do search_path da sessão que a chama (ex: durante
-- CREATE INDEX CONCURRENTLY, que pode inlinar/reavaliar a expressão).
CREATE OR REPLACE FUNCTION normalize_name(name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT lower(regexp_replace(trim(unaccent(coalesce(name, ''))), '\s+', ' ', 'g'));
$$;
