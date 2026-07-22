DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT n.nspname, p.proname, pg_get_function_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'unaccent'
  LOOP
    RAISE NOTICE 'unaccent found: schema=% args=%', r.nspname, r.args;
  END LOOP;

  FOR r IN
    SELECT extname, nspname
    FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE extname = 'unaccent'
  LOOP
    RAISE NOTICE 'unaccent extension installed in schema=%', r.nspname;
  END LOOP;

  RAISE NOTICE 'current search_path=%', current_setting('search_path');
END $$;
