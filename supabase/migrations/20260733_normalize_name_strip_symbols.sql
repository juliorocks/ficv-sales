-- messages_logs.contact vem no formato "Nome 🤓 (5599999999999)" (emoji +
-- telefone entre parênteses). normalize_name agora também remove qualquer
-- caractere que não seja letra/dígito/espaço (depois de unaccent+lower),
-- o que elimina emoji e pontuação residual.
CREATE OR REPLACE FUNCTION normalize_name(name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT trim(regexp_replace(
    regexp_replace(lower(unaccent(coalesce(name, ''))), '[^a-z0-9 ]', '', 'g'),
    '\s+', ' ', 'g'
  ));
$$;
